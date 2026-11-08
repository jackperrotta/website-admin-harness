import { parseEmailContact, parseEmailRule, type EmailContact, type EmailSegment, type EmailRule, type EmailPurpose, type EmailSettings, type EmailRecord, defaultEmailSettings, type EmailTopic, starterEmailTemplates, type EmailTemplate } from '../../../contracts/src/email-campaigns.ts';
import type { AdminManifest } from '../../../contracts/src/index.ts';
import { type CampaignEnv, fail, emailKey, scopeOf, encrypt, decrypt, random, digest, csvCell, parseCsv, object } from './shared.ts';
export interface ContactRow {
    site_id: string;
    id: string;
    email_key: string;
    email: string;
    name: string;
    company: string;
    stage: string;
    tags_json: string;
    fields_json: string;
    source: string;
    interaction_ref: string;
    service_ref: string;
    evidence: string;
    revision: number;
    created_at: number;
    updated_at: number;
    deleted_at: number | null;
}
interface RecordRow {
    id: string;
    revision: number;
    data_json: string;
    created_at: number;
    updated_at: number;
}
export class EmailStore {
    readonly site: string;
    readonly scope: string;
    operations = 0;
    constructor(readonly env: CampaignEnv, readonly manifest: AdminManifest) { this.site = manifest.site.id; this.scope = scopeOf(manifest); }
    sql(query: string, ...args: (string | number | null)[]) { this.operations++; return this.env.DB.prepare(query).bind(...args); }
    async schema() { try {
        await this.sql('SELECT id FROM email_records WHERE site_id=? LIMIT 1', this.site).first();
        return true;
    }
    catch {
        return false;
    } }
    async requireSchema() { if (!await this.schema())
        fail(503, 'email_schema', 'Apply the optional email-campaigns migration to this installation before using this module.'); }
    async get<T>(kind: string, id: string): Promise<(T & {
        id: string;
        revision: number;
    }) | null> { const row = await this.sql('SELECT * FROM email_records WHERE site_id=? AND kind=? AND id=?', this.site, kind, id).first<RecordRow>(); return row ? { ...JSON.parse(row.data_json) as T, id: row.id, revision: row.revision } : null; }
    async list<T>(kind: string, limit = 100, cursor = ''): Promise<Array<T & {
        id: string;
        revision: number;
    }>> { return (await this.sql('SELECT * FROM email_records WHERE site_id=? AND kind=? AND id>? ORDER BY id LIMIT ?', this.site, kind, cursor, limit).all<RecordRow>()).results.map(row => ({ ...JSON.parse(row.data_json) as T, id: row.id, revision: row.revision })); }
    async put<T>(kind: string, id: string, revision: number, data: T) {
        if(new TextEncoder().encode(JSON.stringify(data)).byteLength>1800000)fail(413,'record_limit','Split this audience or content into smaller records.');
        const now = Date.now(), row = await this.sql('INSERT INTO email_records(site_id,kind,id,revision,data_json,created_at,updated_at) SELECT ?,?,?,1,?,?,? WHERE ?=0 ON CONFLICT(site_id,kind,id) DO UPDATE SET revision=email_records.revision+1,data_json=excluded.data_json,updated_at=excluded.updated_at WHERE email_records.revision=? RETURNING revision', this.site, kind, id, JSON.stringify(data), now, now, revision, revision).first<{
            revision: number;
        }>();
        // An existing revision does not take the INSERT path. Use an explicit CAS update.
        if (!row && revision > 0) {
            const updated = await this.sql('UPDATE email_records SET data_json=?,revision=revision+1,updated_at=? WHERE site_id=? AND kind=? AND id=? AND revision=? RETURNING revision', JSON.stringify(data), now, this.site, kind, id, revision).first<{
                revision: number;
            }>();
            if (updated)
                return { ...data, id, revision: updated.revision };
        }
        if (!row)
            fail(409, 'email_conflict', 'This record changed. Reload the saved version; your draft has not been replaced.');
        return { ...data, id, revision: row.revision };
    }
    async active<T>(kind:string,states:string[],limit=100):Promise<Array<T&{id:string;revision:number}>>{
        const rows=(await this.sql(`SELECT * FROM email_records WHERE site_id=? AND kind=? AND json_extract(data_json,'$.status') IN (${states.map(()=>'?').join(',')}) ORDER BY updated_at,id LIMIT ?`,this.site,kind,...states,limit).all<RecordRow>()).results;
        return rows.map(row=>({...JSON.parse(row.data_json) as T,id:row.id,revision:row.revision}));
    }
    async dueDrafts<T>():Promise<Array<T&{id:string;revision:number}>>{
        const rows=(await this.sql("SELECT * FROM email_records WHERE site_id=? AND kind='campaign' AND json_extract(data_json,'$.nextIssueAt')>0 AND json_extract(data_json,'$.nextIssueAt')<=? ORDER BY updated_at,id LIMIT 20",this.site,Date.now()).all<RecordRow>()).results;
        return rows.map(row=>({...JSON.parse(row.data_json) as T,id:row.id,revision:row.revision}));
    }
    async settings(): Promise<EmailRecord<EmailSettings>> { const row = await this.sql("SELECT * FROM email_records WHERE site_id=? AND kind='settings' AND id='settings'", this.site).first<RecordRow>(); return { id: 'settings', revision: row?.revision || 0, data: row ? JSON.parse(row.data_json) as EmailSettings : defaultEmailSettings(), createdAt: row?.created_at || 0, updatedAt: row?.updated_at || 0 }; }
    async seedTemplates() { for (const template of starterEmailTemplates())
        await this.sql("INSERT OR IGNORE INTO email_records(site_id,kind,id,revision,data_json,created_at,updated_at) VALUES(?,'template',?,1,?,?,?)", this.site, template.id, JSON.stringify({ ...template, revision: 1 }), Date.now(), Date.now()).run(); }
    async contact(id: string) { const row = await this.sql('SELECT * FROM email_contacts WHERE site_id=? AND id=? AND deleted_at IS NULL', this.site, id).first<ContactRow>(); if (!row)
        return null; return this.dto(row); }
    async dto(row: ContactRow): Promise<EmailContact> { const preferences = (await this.sql('SELECT topic,status FROM email_preferences WHERE site_id=? AND contact_id=?', this.site, row.id).all<{
        topic: EmailTopic;
        status: string;
    }>()).results; return { id: row.id, revision: row.revision, email: row.email, name: row.name, company: row.company, stage: row.stage, tags: JSON.parse(row.tags_json) as string[], fields: JSON.parse(row.fields_json) as Record<string, string>, source: row.source, interactionRef: row.interaction_ref, serviceRef: row.service_ref, evidence: row.evidence, topics: Object.fromEntries(preferences.map(p => [p.topic, p.status === 'subscribed'])), deleted: row.deleted_at !== null }; }
    async saveContact(input: EmailContact, verified = false) {
        const key = await emailKey(this.env, this.scope, input.email), existing = await this.sql('SELECT * FROM email_contacts WHERE site_id=? AND email_key=?', this.site, key).first<ContactRow>();
        if (existing && input.id && existing.id !== input.id)
            fail(409, 'email_duplicate', 'This email belongs to another contact.');
        if (existing?.deleted_at)
            fail(409, 'email_deleted', 'This address has a retained deletion/suppression record.');
        const id = input.id || existing?.id || crypto.randomUUID(), revision = input.id ? input.revision : existing?.revision || 0;
        const old = await this.sql('SELECT * FROM email_contacts WHERE site_id=? AND id=?', this.site, id).first<ContactRow>();
        if (old && old.revision !== revision || !old && revision !== 0)
            fail(409, 'email_conflict', 'This contact changed. Reload before saving.');
        if (old && old.email_key !== key)
            fail(400, 'email_identity', 'Create a new contact for a changed email; existing subscriptions cannot transfer to another address.');
        if (Object.values(input.topics).some(Boolean) && !input.evidence)
            fail(400, 'email_evidence', 'Record the source of permission before subscribing a contact.');
        const now = Date.now();
        const statement = old ? this.sql('UPDATE email_contacts SET email=?,name=?,company=?,stage=?,tags_json=?,fields_json=?,source=?,interaction_ref=?,service_ref=?,evidence=?,revision=revision+1,updated_at=? WHERE site_id=? AND id=? AND revision=? RETURNING id', input.email, input.name, input.company, input.stage, JSON.stringify(input.tags), JSON.stringify(input.fields), input.source, input.interactionRef, input.serviceRef, input.evidence, now, this.site, id, revision) : this.sql('INSERT INTO email_contacts(site_id,id,email_key,email,name,company,stage,tags_json,fields_json,source,interaction_ref,service_ref,evidence,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id', this.site, id, key, input.email, input.name, input.company, input.stage, JSON.stringify(input.tags), JSON.stringify(input.fields), input.source, input.interactionRef, input.serviceRef, input.evidence, now, now);
        if (!await statement.first())
            fail(409, 'email_conflict', 'This contact changed while saving.');
        for (const [topic, subscribed] of Object.entries(input.topics))
            await this.preference(id, topic as EmailTopic, subscribed, input.evidence, verified);
        return (await this.contact(id))!;
    }
    async preference(id: string, topic: EmailTopic, subscribed: boolean, evidence: string, verified = false) {
        const current = await this.sql('SELECT status FROM email_preferences WHERE site_id=? AND contact_id=? AND topic=?', this.site, id, topic).first<{
            status: string;
        }>();
        if (subscribed && current?.status === 'unsubscribed' && !verified)
            return;
        await this.sql('INSERT INTO email_preferences(site_id,contact_id,topic,status,evidence_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(site_id,contact_id,topic) DO UPDATE SET status=excluded.status,evidence_json=excluded.evidence_json,updated_at=excluded.updated_at', this.site, id, topic, subscribed ? 'subscribed' : 'unsubscribed', JSON.stringify({ source: evidence, verified, at: Date.now() }), Date.now()).run();
        if (!subscribed)
            await this.sql("UPDATE email_jobs SET state='suppressed',reason='topic_opt_out',updated_at=? WHERE site_id=? AND contact_id=? AND topic=? AND state IN ('pending','preparing','blocked')", Date.now(), this.site, id, topic).run();
    }
    async suppress(id: string, reason: string) { const contact = await this.sql('SELECT email_key FROM email_contacts WHERE site_id=? AND id=?', this.site, id).first<{
        email_key: string;
    }>(); if (!contact)
        return; await this.env.DB.batch([this.sql('INSERT INTO email_suppressions(site_id,email_key,reason,created_at) VALUES(?,?,?,?) ON CONFLICT(site_id,email_key) DO NOTHING', this.site, contact.email_key, reason, Date.now()), this.sql("UPDATE email_jobs SET state='suppressed',reason=?,updated_at=? WHERE site_id=? AND contact_id=? AND state IN ('pending','preparing','blocked')", reason, Date.now(), this.site, id), this.sql("UPDATE email_enrollments SET state='stopped',updated_at=? WHERE site_id=? AND contact_id=? AND state='active'", Date.now(), this.site, id)]); }
    async removeContact(id: string, revision: number) { const row = await this.sql('SELECT revision FROM email_contacts WHERE site_id=? AND id=? AND deleted_at IS NULL', this.site, id).first<{
        revision: number;
    }>(); if (!row)
        fail(404, 'not_found', 'Contact not found.'); if (row.revision !== revision)
        fail(409, 'email_conflict', 'Reload this contact before deleting.'); await this.suppress(id, 'deleted'); await this.sql("UPDATE email_contacts SET email='',name='',company='',tags_json='[]',fields_json='{}',evidence='',source='deleted',stage='deleted',interaction_ref='',service_ref='',deleted_at=?,updated_at=?,revision=revision+1 WHERE site_id=? AND id=? AND revision=?", Date.now(), Date.now(), this.site, id, revision).run(); await this.sql('DELETE FROM email_tokens WHERE site_id=? AND contact_id=?', this.site, id).run(); await this.sql("UPDATE email_enrollments SET context_cipher='' WHERE site_id=? AND contact_id=?",this.site,id).run(); await this.sql("UPDATE email_jobs SET payload_cipher='',message_cipher='' WHERE site_id=? AND contact_id=?", this.site, id).run(); await this.sql("UPDATE email_preferences SET status='unsubscribed',evidence_json='{}' WHERE site_id=? AND contact_id=?", this.site, id).run(); await this.sql('DELETE FROM email_clicks WHERE site_id=? AND job_id IN (SELECT id FROM email_jobs WHERE site_id=? AND contact_id=?)', this.site, this.site, id).run(); }
    rule(rule: EmailRule): {
        sql: string;
        args: string[];
    } {
        parseEmailRule(rule);
        const columns: Record<string, string> = { stage: 'c.stage', source: 'c.source', company: 'c.company', service: 'c.service_ref', interaction: 'c.interaction_ref' };
        const op = rule.op, neg = op === 'neq' || op === 'not_exists';
        let sql: string, args: string[] = [];
        if (rule.field === 'tag') {
            sql = 'EXISTS(SELECT 1 FROM json_each(c.tags_json) j WHERE j.value=?)';
            args = [rule.value];
        }
        else if (rule.field === 'topic') {
            sql = "EXISTS(SELECT 1 FROM email_preferences p WHERE p.site_id=c.site_id AND p.contact_id=c.id AND p.topic=? AND p.status='subscribed')";
            args = [rule.value];
        }
        else if (rule.field === 'event') {
            sql = 'EXISTS(SELECT 1 FROM email_events e WHERE e.site_id=c.site_id AND e.contact_id=c.id AND e.type=?)';
            args = [rule.value];
        }
        else {
            const field = rule.field.startsWith('custom.') ? `COALESCE(json_extract(c.fields_json,'$.${rule.field.slice(7)}'),'')` : columns[rule.field];
            if (!field)
                fail(400, 'segment_field', 'Unsupported segment field.');
            if (op === 'exists' || op === 'not_exists')
                sql = `${field}<>''`;
            else if (op === 'contains') {
                sql = `instr(lower(${field}),lower(?))>0`;
                args = [rule.value];
            }
            else {
                sql = `${field}=?`;
                args = [rule.value];
            }
        }
        return { sql: neg ? `NOT (${sql})` : sql, args };
    }
    filter(segment?: EmailSegment | null) { if (!segment?.rules.length)
        return { sql: '1=1', args: [] as string[] }; const rules = segment.rules.map(r => this.rule(r)); return { sql: '(' + rules.map(r => r.sql).join(segment.match === 'all' ? ' AND ' : ' OR ') + ')', args: rules.flatMap(r => r.args) }; }
    async contacts(options: {
        segment?: EmailSegment | null;
        cursor?: string;
        limit?: number;
        q?: string;
        cutoff?: number;
    } = {}) { const f = this.filter(options.segment); const query = options.q || ''; return (await this.sql(`SELECT c.* FROM email_contacts c WHERE c.site_id=? AND c.deleted_at IS NULL AND c.id>? AND c.created_at<=? AND ${f.sql} AND (?='' OR instr(lower(c.name||' '||c.email||' '||c.company),lower(?))>0) ORDER BY c.id LIMIT ?`, this.site, options.cursor || '', options.cutoff || Date.now(), ...f.args, query, query, options.limit || 100).all<ContactRow>()).results; }
    async audience(segment?: EmailSegment | null, purpose?: EmailPurpose) { const f = this.filter(segment), total = (await this.sql(`SELECT count(*) n FROM email_contacts c WHERE c.site_id=? AND c.deleted_at IS NULL AND ${f.sql}`, this.site, ...f.args).first<{
        n: number;
    }>())?.n || 0; let eligible = 0; if (purpose && purpose !== 'newsletter-draft') {
        const topic = purpose === 'customer-report' ? 'reports' : 'service';
        const evidence = purpose === 'enquiry-response' ? "c.interaction_ref<>''" : "c.service_ref<>''";
        eligible = (await this.sql(`SELECT count(*) n FROM email_contacts c WHERE c.site_id=? AND c.deleted_at IS NULL AND ${f.sql} AND ${evidence} AND NOT EXISTS(SELECT 1 FROM email_suppressions s WHERE s.site_id=c.site_id AND s.email_key=c.email_key) AND EXISTS(SELECT 1 FROM email_preferences p WHERE p.site_id=c.site_id AND p.contact_id=c.id AND p.topic=? AND p.status='subscribed')`, this.site, ...f.args, topic).first<{
            n: number;
        }>())?.n || 0;
    } return { total, eligible, excluded: total - eligible, sample: await Promise.all((await this.contacts({ segment, limit: 10 })).map(r => this.dto(r))) }; }
    async eligibility(contact: EmailContact | null, purpose: EmailPurpose) { if (!contact || contact.deleted)
        return 'contact_unavailable'; if (purpose === 'newsletter-draft')
        return 'newsletter_draft_only'; if (purpose === 'enquiry-response' ? !contact.interactionRef : !contact.serviceRef)
        return 'purpose_evidence_missing'; const key = await emailKey(this.env, this.scope, contact.email); const suppression = await this.sql('SELECT reason FROM email_suppressions WHERE site_id=? AND email_key=?', this.site, key).first<{
        reason: string;
    }>(); if (suppression)
        return suppression.reason; if (!contact.topics[purpose === 'customer-report' ? 'reports' : 'service'])
        return 'topic_not_subscribed'; return ''; }
    async limit(bucket: string, maximum: number, windowMs: number) { const now = Date.now(); const row = await this.sql('INSERT INTO email_limits(site_id,bucket,count,expires_at) VALUES(?,?,1,?) ON CONFLICT(site_id,bucket) DO UPDATE SET count=email_limits.count+1 WHERE email_limits.count<? RETURNING count', this.site, `${bucket}:${Math.floor(now / windowMs)}`, now + 2 * windowMs, maximum).first(); if (!row)
        fail(429, 'email_rate_limit', 'This operation has reached its current limit. Try again later.'); }
    async token(contactId: string, purpose: 'preferences' | 'confirm', topic: EmailTopic) { const contact = await this.contact(contactId); if (!contact)
        fail(404, 'not_found', 'Contact not found.'); const raw = random(), key = await emailKey(this.env, this.scope, contact.email); await this.sql('INSERT INTO email_tokens(site_id,digest,contact_id,purpose,topic,email_key,expires_at) VALUES(?,?,?,?,?,?,?)', this.site, await digest(this.scope + '|' + raw), contactId, purpose, topic, key, Date.now() + (purpose === 'confirm' ? 86400000 : 730 * 86400000)).run(); return raw; }
    async resolveToken(raw: string, purpose: string) { if (!/^[A-Za-z0-9_-]{43}$/.test(raw))
        fail(401, 'email_link', 'This email link is invalid or expired.'); const row = await this.sql('SELECT * FROM email_tokens WHERE site_id=? AND digest=? AND purpose=? AND expires_at>? AND consumed_at IS NULL', this.site, await digest(this.scope + '|' + raw), purpose, Date.now()).first<{
        contact_id: string;
        topic: EmailTopic;
        email_key: string;
        digest: string;
    }>(); if (!row)
        fail(401, 'email_link', 'This email link is invalid or expired.'); const c = await this.contact(row.contact_id); if (!c || await emailKey(this.env, this.scope, c.email) !== row.email_key)
        fail(401, 'email_link', 'This email link is no longer valid.'); return { ...row, contact: c }; }
    async importPreview(csv: string, mapping: Record<string, string>, evidence: string) { const rows = parseCsv(csv), headers = rows.shift()?.map(x => x.replace(/^\uFEFF/, '').trim()) || []; if (!headers.length || !headers.includes(mapping.email))
        fail(400, 'csv_mapping', 'Map an email column.'); const index = (key: string) => headers.indexOf(mapping[key]), get = (row: string[], key: string) => row[index(key)] || ''; const values: EmailContact[] = [], errors: Array<{
        row: number;
        error: string;
    }> = []; const seen = new Set<string>(); for (const [i, row] of rows.entries()) {
        try {
            const email = get(row, 'email'), key = email.toLowerCase();
            if (seen.has(key))
                continue;
            seen.add(key);
            values.push(parseEmailContact({ email, name: get(row, 'name'), company: get(row, 'company'), stage: get(row, 'stage') || 'lead', tags: get(row, 'tags').split('|').filter(Boolean), fields: get(row,'fields')?JSON.parse(get(row,'fields')):Object.fromEntries(Object.entries(mapping).filter(([key])=>key.startsWith('custom.')).map(([key])=>[key.slice(7),get(row,key)])), source: 'csv', interactionRef: get(row, 'interactionRef'), serviceRef: get(row, 'serviceRef'), topics: {}, evidence, revision: 0 }));
        }
        catch (e) {
            errors.push({ row: i + 2, error: e instanceof Error ? e.message : 'Invalid row' });
        }
    } return { headers, rows: values, total: rows.length, valid: values.length, duplicates: rows.length - values.length - errors.length, errors }; }
    async startImport(csv: string, mapping: Record<string, string>, evidence: string) {
        const preview = await this.importPreview(csv, mapping, evidence);
        if (preview.errors.length)
            fail(400, 'csv_errors', 'Correct invalid rows before importing.');
        const fingerprint = await digest(JSON.stringify({ csv, mapping, evidence }));
        const existing = await this.sql('SELECT id,cursor,total,state,created_at FROM email_imports WHERE site_id=? AND digest=?', this.site, fingerprint).first();
        if (existing&&!['failed','expired'].includes(String(existing.state)))
            return existing;
        const id = existing?String(existing.id):crypto.randomUUID(), statements = [this.sql("INSERT INTO email_imports(site_id,id,digest,total,state,payload_cipher,created_at) VALUES(?,?,?,?,'pending','',?) ON CONFLICT(site_id,id) DO UPDATE SET state='pending',cursor=0,total=excluded.total,created_at=excluded.created_at WHERE email_imports.state IN ('failed','expired')", this.site, id, fingerprint, preview.rows.length, Date.now())];
        for (let i = 0; i < preview.rows.length; i += 200)
            statements.push(this.sql('INSERT OR REPLACE INTO email_import_chunks(site_id,import_id,chunk_no,payload_cipher) VALUES(?,?,?,?)', this.site, id, i / 200, await encrypt(this.env, this.scope + '|import|' + fingerprint + '|' + i / 200, preview.rows.slice(i, i + 200))));
        await this.env.DB.batch(statements);
        return this.sql('SELECT id,cursor,total,state,created_at FROM email_imports WHERE site_id=? AND id=?', this.site, id).first();
    }
    async processImports() {
        const job = await this.sql("SELECT id,digest,cursor,total FROM email_imports WHERE site_id=? AND state='pending' ORDER BY created_at LIMIT 1", this.site).first<{
            id: string;
            digest: string;
            cursor: number;
            total: number;
        }>();
        if (!job)
            return;
        let cursor = job.cursor;
        for (let pass = 0; pass < 5 && cursor < job.total; pass++) {
            const chunkNo = Math.floor(cursor / 200), row = await this.sql('SELECT payload_cipher FROM email_import_chunks WHERE site_id=? AND import_id=? AND chunk_no=?', this.site, job.id, chunkNo).first<{
                payload_cipher: string;
            }>();
            if(!row){await this.sql("UPDATE email_imports SET state='failed' WHERE site_id=? AND id=?",this.site,job.id).run();return;}
            const contacts = await decrypt<EmailContact[]>(this.env, this.scope + '|import|' + job.digest + '|' + chunkNo, row.payload_cipher), statements: D1PreparedStatement[] = [];
            for (let i = 0; i < contacts.length; i += 6) {
                const group = contacts.slice(i, i + 6), values: (string | number | null)[] = [];
                for (const c of group)
                    values.push(this.site, crypto.randomUUID(), await emailKey(this.env, this.scope, c.email), c.email, c.name, c.company, c.stage, JSON.stringify(c.tags), JSON.stringify(c.fields), c.source, c.interactionRef, c.serviceRef, c.evidence, Date.now(), Date.now());
                statements.push(this.sql('INSERT OR IGNORE INTO email_contacts(site_id,id,email_key,email,name,company,stage,tags_json,fields_json,source,interaction_ref,service_ref,evidence,created_at,updated_at) VALUES ' + group.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(','), ...values));
            }
            const next = Math.min(job.total, (chunkNo + 1) * 200);
            statements.push(this.sql('UPDATE email_imports SET cursor=?,state=? WHERE site_id=? AND id=? AND cursor=?', next, next === job.total ? 'completed' : 'pending', this.site, job.id, cursor));
            await this.env.DB.batch(statements);
            cursor = next;
        }
        if (cursor === job.total)
            await this.sql('DELETE FROM email_import_chunks WHERE site_id=? AND import_id=?', this.site, job.id).run();
    }
    async exportContacts(query='') { const rows = (await this.sql('SELECT * FROM email_contacts WHERE site_id=? AND deleted_at IS NULL AND instr(lower(name||email||company),lower(?))>0 ORDER BY id LIMIT 10001', this.site,query).all<ContactRow>()).results; if (rows.length > 10000)
        fail(413, 'export_limit', 'Export smaller segments before this installation exceeds 10,000 contacts.'); const preferences=(await this.sql('SELECT contact_id,topic,status FROM email_preferences WHERE site_id=?',this.site).all<{contact_id:string;topic:string;status:string}>()).results,topics=new Map<string,Record<string,boolean>>();for(const p of preferences){const value=topics.get(p.contact_id)||{};value[p.topic]=p.status==='subscribed';topics.set(p.contact_id,value);}const contacts=rows.map(r=>({id:r.id,email:r.email,name:r.name,company:r.company,stage:r.stage,tags:JSON.parse(r.tags_json) as string[],source:r.source,serviceRef:r.service_ref,interactionRef:r.interaction_ref,evidence:r.evidence,topics:topics.get(r.id)||{},fields:JSON.parse(r.fields_json)})); return ['id,email,name,company,stage,tags,source,serviceRef,interactionRef,evidence,topics,fields', ...contacts.map(c => [c.id, c.email, c.name, c.company, c.stage, c.tags.join('|'), c.source, c.serviceRef, c.interactionRef, c.evidence, JSON.stringify(c.topics),JSON.stringify(c.fields)].map(csvCell).join(','))].join('\r\n'); }
}
