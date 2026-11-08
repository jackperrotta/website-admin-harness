import { readFile, writeFile, mkdir, readdir, lstat, realpath } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { parseManifest, isLoopback } from '../../contracts/src/index.ts';
import type { EmailModuleConfig } from '../../contracts/src/email-campaigns.ts';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const read = (path: string) => readFile(path, 'utf8');
const save = async (path: string, value: unknown) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value, null, 2) + '\n'); };
interface FileChange {
    path: string;
    before: string | null;
    after: string;
}
/** Prepares an exact local installation diff. Never provisions, deploys, or sends mail. */
export async function emailSetup(options: {
    dir?: string;
    from?: string;
    site?: string;
    plan?: boolean;
    apply?: boolean;
    local?: boolean;
}, packageRoot: string) {
    if (!options.dir || !options.from || !!options.plan === !!options.apply)
        throw Error('email-setup requires --dir, --from and exactly one of --plan or --apply.');
    const root = await realpath(resolve(options.dir)), source = await read(resolve(options.from));
    const input = JSON.parse(source) as {
        from: string;
        module: EmailModuleConfig;
    };
    if (!input.module || !/^[a-z][a-z0-9-]{0,57}$/.test(input.module.feedbackQueue) || typeof input.from !== 'string' || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.from))
        throw Error('Configure the business sender and exact feedback queue.');
    if (!options.local && (!input.module.accountId || !input.module.zoneId || !input.module.eventSubscriptionId || !input.module.sendingDomain || !input.module.dailyLimit))
        throw Error('Production setup needs this business’s account, zone, subscription, sending domain and actual daily quota.');
    if (input.module.sendingDomain && !input.from.toLowerCase().endsWith('@' + input.module.sendingDomain))
        throw Error('Sender must belong to the configured sending domain.');
    const local = !!options.local, manifestPath = join(root, local ? 'admin.local.json' : 'admin.config.json'), manifestText = await read(manifestPath), manifest = parseManifest(JSON.parse(manifestText));
    if (local && !isLoopback(manifest.adminOrigin) || !local && isLoopback(manifest.adminOrigin))
        throw Error('Loopback setup requires explicit --local; production must use HTTPS.');
    const workerPath = join(root, local ? 'worker.local.ts' : 'worker.ts'), wranglerPath = join(root, local ? 'wrangler.local.jsonc' : 'wrangler.jsonc'), worker = await read(workerPath), wranglerText = await read(wranglerPath), wrangler = JSON.parse(wranglerText) as Record<string, unknown>;
    const directory = join(root, '.vitris/email-setup'), planPath = join(directory, local ? 'local-plan.json' : 'plan.json'), receiptPath = join(directory, local ? 'local-receipt.json' : 'receipt.json');
    const prepared = options.apply ? JSON.parse(await read(planPath)) as {
        files: FileChange[];
        inputs: Record<string, string>;
        filesDigest: string;
    } : null;
    const inputs = { from: hash(source), version: JSON.parse(await read(join(packageRoot, 'package.json'))).version as string, cli: hash(await read(join(packageRoot, 'bin/admin.mjs'))) };
    if (prepared) {
        if (prepared.filesDigest !== hash(JSON.stringify(prepared.files)))
            throw Error('The reviewed email file diff changed. Prepare a new plan.');
        for (const file of prepared.files) {
            const rel = relative(root, resolve(file.path)).replaceAll('\\', '/');
            const website = options.site && resolve(file.path) === resolve(options.site, 'launch.json');
            if (!website && (isAbsolute(rel) || rel.startsWith('..') || !/^(admin\.(config|local)\.json|worker(\.local)?\.ts|wrangler(\.local)?\.jsonc|modules\/email-campaigns\/index\.ts|migrations\/\d{4}_email_campaigns\.sql)$/.test(rel)))
                throw Error('Email plan contains an unrelated target path.');
            let parent = resolve(file.path);
            for (;;) {
                try {
                    if ((await lstat(parent)).isSymbolicLink())
                        throw Error('Preserve linked installation files and integrate email manually.');
                }
                catch (e) {
                    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                        throw e;
                }
                if (parent === root || dirname(parent) === parent)
                    break;
                parent = dirname(parent);
            }
        }
        if (JSON.stringify(prepared.inputs) !== JSON.stringify(inputs))
            throw Error('Setup inputs or package changed. Prepare a new email plan.');
        let unchanged = true;
        for (const file of prepared.files) {
            const current = await read(file.path).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT')
                return null; throw e; });
            if (current !== file.after)
                unchanged = false;
            if (current !== file.before && current !== file.after)
                throw Error('An installation file changed. Prepare a new email plan.');
        }
        if (unchanged) {
            console.log('Email setup already matches the reviewed plan. No files changed.');
            return;
        }
        for (const file of prepared.files) {
            await mkdir(dirname(file.path), { recursive: true });
            if (file.before !== null)
                await writeFile(join(directory, 'backups', hash(file.path + '|' + file.before) + '.txt'), file.before).catch(async (e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT')
                    throw e; await mkdir(join(directory, 'backups'), { recursive: true }); await writeFile(join(directory, 'backups', hash(file.path) + '.txt'), file.before!); });
            await writeFile(file.path, file.after);
        }
        await save(receiptPath, { inputs, files: prepared.files.map(f => ({ path: f.path, sha256: hash(f.after) })), cloudWrites: false, liveSending: false });
        console.log('Applied the reviewed local installation diff. No cloud resources, remote databases, email subscriptions or recipients changed.');
        return;
    }
    if (worker.includes('createPagesAdmin'))
        throw Error('Existing Pages installations retain Pages. Use the documented private createEmailCampaignWorker setup and review the separate scheduler/queue Worker diff.');
    const modulePath = join(root, 'modules/email-campaigns/index.ts'), existingModule = await read(modulePath).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT')
        return null; throw e; });
    const moduleText = `import {createEmailCampaigns} from '@tryvitris/website-admin-harness/email-campaigns';\nexport default createEmailCampaigns(${JSON.stringify(input.module, null, 2)});\n`;
    if (existingModule && existingModule !== moduleText)
        throw Error('An authored email module already exists. Review its configuration diff manually.');
    let nextWorker = worker;
    if (!worker.includes("./modules/email-campaigns/index")) {
        const match = worker.match(/createAdmin\((\w+)\)/);
        if (match)
            nextWorker = worker.replace(match[0], `createAdmin(${match[1]}, {modules:[emailCampaigns]})`);
        else if (/createAdmin\(\w+,\s*\{\s*modules\s*:\s*\[[^\]]*\]\s*\}\)/.test(worker))
            nextWorker = worker.replace(/(createAdmin\(\w+,\s*\{\s*modules\s*:\s*)\[([^\]]*)\]/, (_, prefix: string, modules: string) => `${prefix}[${modules.trim()}${modules.trim() ? ',' : ''}emailCampaigns]`);
        else
            throw Error('Custom Worker composition needs a manual import/modules diff; existing entry points were preserved.');
        nextWorker = "import emailCampaigns from './modules/email-campaigns/index';\n" + nextWorker;
    }
    const nextManifest = { ...manifest, modules: [...new Set([...manifest.modules, 'email-campaigns'])] }, vars = wrangler.vars as Record<string, unknown> || {};
    const senderBindings = (wrangler.send_email as Array<{
        name: string;
        allowed_sender_addresses?: string[];
    }> | undefined) || [];
    const existingBinding = senderBindings.find(x => x.name === 'CAMPAIGN_EMAIL');
    if (existingBinding && JSON.stringify(existingBinding.allowed_sender_addresses) !== JSON.stringify([input.from]))
        throw Error('An existing campaign sender differs. Review the binding explicitly.');
    const queues = wrangler.queues as {
        consumers?: Array<{
            queue: string;
        }>;
        [key: string]: unknown;
    } | undefined;
    const nextWrangler = { ...wrangler, vars: { ...vars, CAMPAIGN_FROM: input.from, CAMPAIGN_SEND_ENABLED: vars.CAMPAIGN_SEND_ENABLED || '0', CAMPAIGN_EMAIL_READY: vars.CAMPAIGN_EMAIL_READY || '0', CAMPAIGN_FEEDBACK_READY: vars.CAMPAIGN_FEEDBACK_READY || '0' }, ...(!local ? { send_email: existingBinding ? senderBindings : [...senderBindings, { name: 'CAMPAIGN_EMAIL', allowed_sender_addresses: [input.from] }], queues: { ...queues, consumers: [...(queues?.consumers || []).filter(q => q.queue !== input.module.feedbackQueue), { queue: input.module.feedbackQueue, max_batch_size: 20, max_retries: 5, dead_letter_queue: input.module.feedbackQueue + '-dead' }] }, triggers: { ...(wrangler.triggers as object || {}), crons: [...new Set([...((wrangler.triggers as {
                            crons?: string[];
                        })?.crons || []), '* * * * *'])] } } : {}) };
    const migrations = await readdir(join(root, 'migrations')), number = Math.max(0, ...migrations.map(f => Number(f.match(/^(\d{4})_/)?.[1] || 0))) + 1, migrationPath = join(root, 'migrations', String(number).padStart(4, '0') + '_email_campaigns.sql');
    const files: FileChange[] = [{ path: manifestPath, before: manifestText, after: JSON.stringify(nextManifest, null, 2) + '\n' }, { path: workerPath, before: worker, after: nextWorker }, { path: wranglerPath, before: wranglerText, after: JSON.stringify(nextWrangler, null, 2) + '\n' }, { path: modulePath, before: existingModule, after: moduleText }];
    if (!migrations.some(f => f.endsWith('_email_campaigns.sql')))
        files.push({ path: migrationPath, before: null, after: await read(join(packageRoot, 'modules/email-campaigns/migrations/0001_email_campaigns.sql')) });
    if (options.site) {
        const siteRoot = resolve(options.site), launchPath = join(siteRoot, 'launch.json'), before = await read(launchPath), launch = JSON.parse(before) as Record<string, unknown>;
        if (local && !isLoopback(manifest.site.origin))
            throw Error('A local website connection requires an exact loopback website origin in admin.local.json.');
        if (launch.publicOrigin !== manifest.site.origin)
            throw Error('Website origin differs from this installation.');
        const connection = { version: 1, installationId: manifest.installationId, siteId: manifest.site.id, adminOrigin: manifest.adminOrigin, websiteOrigin: manifest.site.origin };
        if (launch.emailCampaigns && JSON.stringify(launch.emailCampaigns) !== JSON.stringify(connection))
            throw Error('An existing website email connection differs.');
        files.push({ path: launchPath, before, after: JSON.stringify({ ...launch, emailCampaigns: connection }, null, 2) + '\n' });
    }
    await save(planPath, { schemaVersion: 1, inputs, files, filesDigest: hash(JSON.stringify(files)), cloudWrites: false, liveSending: false, requirements: ['Back up the intended D1 before remote migration.', 'Provision the business-owned feedback and dead-letter queues; configure the native sending-domain event subscription.', 'Configure CAMPAIGN_TOKEN_KEYS, stable CAMPAIGN_ID_KEY, and a separate CAMPAIGN_WEBSITE_KEY through protected secrets.', 'Verify sender onboarding, actual quota, feedback delivery and intended transactional purposes before readiness flags.', 'Website event outbox migration and form/event integration are separate reviewed website changes.'] });
    console.log(`Email setup plan saved to ${planPath}. Review the exact files, then repeat with --apply. No cloud writes or email sending.`);
}
