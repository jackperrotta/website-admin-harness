import {chatgptBusinessStatuses, isObject, type AdminManifest, type ChatGPTBusinessStatus} from '../../contracts/src/index.ts';

export const chatgptBusinessModule = {
  id: 'chatgpt-business', version: 1, label: 'Businesses in ChatGPT', permission: 'chatgpt-business:manage' as const,
  description: 'Owner-managed Business Hub onboarding.',
};

const initialStatus: ChatGPTBusinessStatus = {
  claim: 'not_started', verification: 'not_started', agent: 'not_started', lastChecked: null, revision: 0,
};
const columns = 'claim, verification, agent, last_checked AS lastChecked, revision';

export async function chatgptBusinessAvailable(db: D1Database) {
  return !!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chatgpt_business_status'").first();
}

export async function readChatGPTBusinessStatus(db: D1Database, manifest: AdminManifest) {
  return await db.prepare(`SELECT ${columns} FROM chatgpt_business_status WHERE installation_id=? AND site_id=?`)
    .bind(manifest.installationId, manifest.site.id).first<ChatGPTBusinessStatus>() ?? initialStatus;
}

export function isChatGPTBusinessStatusInput(value: unknown): value is ChatGPTBusinessStatus & {lastChecked: string} {
  if (!isObject(value) || Object.keys(value).some(key => !['claim', 'verification', 'agent', 'lastChecked', 'revision'].includes(key))) return false;
  const date = value.lastChecked;
  return Object.entries(chatgptBusinessStatuses).every(([key, allowed]) => (allowed as readonly unknown[]).includes(value[key])) &&
    Number.isSafeInteger(value.revision) && Number(value.revision) >= 0 &&
    typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}

export function saveChatGPTBusinessStatus(db: D1Database, manifest: AdminManifest, status: ChatGPTBusinessStatus) {
  const {claim, verification, agent, lastChecked, revision} = status;
  const {installationId, site: {id: siteId}} = manifest;
  if (revision === 0) {
    return db.prepare(`INSERT INTO chatgpt_business_status (installation_id, site_id, claim, verification, agent, last_checked, revision)
      VALUES (?, ?, ?, ?, ?, ?, 1) ON CONFLICT (installation_id, site_id) DO NOTHING RETURNING ${columns}`)
      .bind(installationId, siteId, claim, verification, agent, lastChecked).first<ChatGPTBusinessStatus>();
  }
  return db.prepare(`UPDATE chatgpt_business_status SET claim=?, verification=?, agent=?, last_checked=?, revision=revision+1
    WHERE installation_id=? AND site_id=? AND revision=? RETURNING ${columns}`)
    .bind(claim, verification, agent, lastChecked, installationId, siteId, revision).first<ChatGPTBusinessStatus>();
}
