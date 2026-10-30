import type {AdminEnv} from '../worker.ts';

/** The view is also the transactional send fence: current settings and native records are authoritative. */
export class AppointmentReminders {
 private env:AdminEnv;
 private site:string;
 constructor(env:AdminEnv,site:string){this.env=env;this.site=site;}
 async eligible(id:string){
  return !!await this.env.DB.prepare(`SELECT 1 FROM scheduling_notification_outbox o JOIN scheduling_due_reminders d
   ON d.site_id=o.site_id AND d.appointment_id=o.appointment_id AND d.starts_at=o.reminder_starts_at
   AND d.offset_minutes=o.reminder_offset_minutes AND d.mode=o.mode AND d.revision=o.appointment_revision
   WHERE o.site_id=? AND o.id=?`).bind(this.site,id).first();
 }
 async enqueue(){
  const now=Date.now();
  await this.env.DB.prepare(`UPDATE scheduling_notification_outbox SET status='superseded',error_code='notification_superseded',lease_id=NULL,lease_until=0,updated_at=?
   WHERE site_id=? AND kind='reminder' AND status IN ('pending','preparing','blocked') AND NOT EXISTS(
    SELECT 1 FROM scheduling_due_reminders d WHERE d.site_id=scheduling_notification_outbox.site_id
    AND d.appointment_id=scheduling_notification_outbox.appointment_id AND d.starts_at=reminder_starts_at
    AND d.offset_minutes=reminder_offset_minutes AND d.revision=appointment_revision AND d.mode=scheduling_notification_outbox.mode
   )`).bind(now,this.site).run();
  await this.env.DB.prepare(`INSERT INTO scheduling_notification_outbox(site_id,id,appointment_id,appointment_revision,kind,mode,dedupe_key,payload_json,reminder_offset_minutes,reminder_starts_at,created_at,updated_at)
   SELECT d.site_id,lower(hex(randomblob(16))),d.appointment_id,d.revision,'reminder',d.mode,
    'reminder:'||d.appointment_id||':'||d.starts_at||':'||d.offset_minutes,d.payload_json,d.offset_minutes,d.starts_at,?,?
   FROM scheduling_due_reminders d WHERE d.site_id=? AND NOT EXISTS(
    SELECT 1 FROM scheduling_notification_outbox o WHERE o.site_id=d.site_id AND o.dedupe_key='reminder:'||d.appointment_id||':'||d.starts_at||':'||d.offset_minutes
    AND (o.status<>'superseded' OR o.reminder_send_started_at IS NOT NULL OR o.mode<>d.mode)
   ) ORDER BY d.due_at,d.appointment_id LIMIT 100
   ON CONFLICT(site_id,dedupe_key) DO UPDATE SET appointment_revision=excluded.appointment_revision,payload_json=excluded.payload_json,
    message_cipher=NULL,status='pending',error_code=NULL,lease_id=NULL,lease_until=0,updated_at=excluded.updated_at
   WHERE scheduling_notification_outbox.status='superseded' AND scheduling_notification_outbox.reminder_send_started_at IS NULL
   AND scheduling_notification_outbox.mode=excluded.mode`).bind(now,now,this.site).run();
 }
}
