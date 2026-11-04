/** Wire-compatible lead operations; this package never imports a sibling checkout. */
export class LeadError extends Error {
    status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
}
export interface LeadFollowUp {
    assignedTo: string | null;
    dueDate: string | null;
    notes: string;
    completed: boolean;
    revision: number;
    updatedAt: string | null;
}
const empty: LeadFollowUp = { assignedTo: null, dueDate: null, notes: '', completed: false, revision: 0, updatedAt: null };
export async function followUpsAvailable(db: D1Database): Promise<boolean> {
    return !!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lead_followups'").first();
}
export function followUpInput(value: unknown): {
    id: string;
    followUp: LeadFollowUp;
} {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new LeadError(400, 'Invalid follow-up');
    const v = value as Record<string, unknown>;
    if (Object.keys(v).some(k => !['id', 'assignedTo', 'dueDate', 'notes', 'completed', 'revision'].includes(k)) || typeof v.id !== 'string' || !v.id || v.id.length > 200 || typeof v.notes !== 'string' || v.notes.length > 3000 || typeof v.completed !== 'boolean' || !Number.isSafeInteger(v.revision) || Number(v.revision) < 0)
        throw new LeadError(400, 'Invalid follow-up fields');
    if (v.assignedTo !== null && (typeof v.assignedTo !== 'string' || !v.assignedTo || v.assignedTo.length > 100))
        throw new LeadError(400, 'Invalid assigned teammate');
    if (v.dueDate !== null && (typeof v.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.dueDate) || !Number.isFinite(Date.parse(v.dueDate + 'T00:00:00Z')) || new Date(v.dueDate + 'T00:00:00Z').toISOString().slice(0, 10) !== v.dueDate))
        throw new LeadError(400, 'Choose a valid follow-up date');
    return { id: v.id, followUp: { assignedTo: v.assignedTo as string | null, dueDate: v.dueDate as string | null, notes: v.notes, completed: v.completed, revision: Number(v.revision), updatedAt: null } };
}
export async function saveFollowUp(db: D1Database, tenant: string, installation: string, value: unknown, scope: 'tenant_id' | 'site_id') {
    const { id, followUp: f } = followUpInput(value);
    if (!await followUpsAvailable(db))
        throw new LeadError(503, 'Lead follow-up requires the reviewed database migration');
    if (!await db.prepare(`SELECT id FROM leads WHERE id=? AND ${scope}=?`).bind(id, tenant).first())
        throw new LeadError(404, 'Lead not found');
    const row = f.revision === 0
        ? await db.prepare(`INSERT INTO lead_followups(tenant_id,installation_id,lead_id,assigned_to,due_date,notes,completed,revision) VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(tenant_id,installation_id,lead_id) DO NOTHING RETURNING revision,updated_at`).bind(tenant, installation, id, f.assignedTo, f.dueDate, f.notes, Number(f.completed)).first<{
            revision: number;
            updated_at: string;
        }>()
        : await db.prepare(`UPDATE lead_followups SET assigned_to=?,due_date=?,notes=?,completed=?,revision=revision+1,updated_at=datetime('now') WHERE tenant_id=? AND installation_id=? AND lead_id=? AND revision=? RETURNING revision,updated_at`).bind(f.assignedTo, f.dueDate, f.notes, Number(f.completed), tenant, installation, id, f.revision).first<{
            revision: number;
            updated_at: string;
        }>();
    if (!row)
        throw new LeadError(409, 'This follow-up changed in another session. Reload before saving; your draft is still here.');
    return { ok: true as const, followUp: { ...f, revision: row.revision, updatedAt: row.updated_at } };
}
export async function listLeads(db: D1Database, tenant: string, installation: string, params: URLSearchParams, scope: 'tenant_id' | 'site_id') {
    const limit = Number(params.get('limit') || 200), query = (params.get('q') || '').trim(), status = params.get('status') || 'all', queue = params.get('queue') || 'all', assignee = params.get('assignee') || '', id = params.get('id') || '';
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || query.length > 200 || !['all', 'new', 'contacted', 'closed'].includes(status) || !['all', 'due'].includes(queue) || assignee.length > 100 || id.length > 200)
        throw new LeadError(400, 'Invalid lead search');
    const enabled = await followUpsAvailable(db);
    if (!enabled && (queue !== 'all' || assignee))
        throw new LeadError(503, 'Lead follow-up requires the reviewed database migration');
    const where = [`l.${scope}=?`], values: unknown[] = [tenant];
    if (query) {
        const term = '%' + query.replace(/[!%_]/g, c => '!' + c) + '%';
        where.push("(l.name LIKE ? ESCAPE '!' OR l.email LIKE ? ESCAPE '!' OR l.message LIKE ? ESCAPE '!')");
        values.push(term, term, term);
    }
    if (status !== 'all') {
        where.push('l.status=?');
        values.push(status);
    }
    if (id) {
        where.push('l.id=?');
        values.push(id);
    }
    if (queue === 'due')
        where.push("f.completed=0 AND f.due_date<=date('now') AND l.status<>'closed'");
    if (assignee) {
        where.push('f.assigned_to=?');
        values.push(assignee);
    }
    const join = enabled ? ` LEFT JOIN lead_followups f ON f.lead_id=l.id AND f.tenant_id=l.${scope} AND f.installation_id=?` : '';
    const prefix = enabled ? [installation] : [];
    const total = await db.prepare(`SELECT COUNT(*) n FROM leads l${join} WHERE ${where.join(' AND ')}`).bind(...prefix, ...values).first<{
        n: number;
    }>();
    const newCount = await db.prepare(`SELECT COUNT(*) n FROM leads WHERE ${scope}=? AND status='new'`).bind(tenant).first<{
        n: number;
    }>();
    if (params.has('cursor')) {
        if (params.get('cursor')!.length > 4096)
            throw new LeadError(400, 'Invalid lead cursor');
        let cursor: unknown;
        try {
            cursor = JSON.parse(decodeURIComponent(params.get('cursor')!));
        }
        catch {
            throw new LeadError(400, 'Invalid lead cursor');
        }
        if (!Array.isArray(cursor) || cursor.length !== 2 || cursor.some(v => typeof v !== 'string' || !v || v.length > 200))
            throw new LeadError(400, 'Invalid lead cursor');
        where.push('(l.created_at<? OR (l.created_at=? AND l.id<?))');
        values.push(cursor[0], cursor[0], cursor[1]);
    }
    const fields = enabled ? ',f.assigned_to,f.due_date,f.notes AS followup_notes,f.completed,f.revision AS followup_revision,f.updated_at AS followup_updated' : '';
    const notifications = scope === 'tenant_id' ? ` LEFT JOIN form_submissions s ON s.id=l.id AND s.tenant_id=l.tenant_id AND s.mode='live' LEFT JOIN form_outbox o ON o.id=s.id AND o.tenant_id=l.tenant_id` : '';
    const extras = scope === 'tenant_id' ? ',s.fields_json,o.status AS notification_status,o.last_error AS notification_error' : '';
    const stored = (await db.prepare(`SELECT l.*${fields}${extras} FROM leads l${join}${notifications} WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC,l.id DESC LIMIT ?`).bind(...prefix, ...values, limit + 1).all<Record<string, unknown>>()).results;
    const rows: Record<string, unknown>[] = [];
    let bytes = 0;
    for (const row of stored.slice(0, limit)) {
        const { assigned_to, due_date, followup_notes, completed, followup_revision, followup_updated, ...lead } = row;
        const result = { ...lead, ...(enabled ? { followUp: followup_revision ? { assignedTo: assigned_to, dueDate: due_date, notes: followup_notes, completed: !!completed, revision: followup_revision, updatedAt: followup_updated } : { ...empty } } : {}) };
        bytes += new TextEncoder().encode(JSON.stringify(result)).length;
        if (bytes > 3500000)
            break;
        rows.push(result);
    }
    if (stored.length && !rows.length)
        throw new LeadError(502, 'A stored lead exceeds the supported response size');
    const last = rows.at(-1), more = stored.length > rows.length;
    return { rows, followUpsEnabled: enabled, pagination: { version: 1 as const, total: total?.n || 0, newCount: newCount?.n || 0, nextCursor: more && last ? encodeURIComponent(JSON.stringify([last.created_at, last.id])) : null }, truncated: more };
}
