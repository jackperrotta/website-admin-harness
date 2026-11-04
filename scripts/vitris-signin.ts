import {refreshPortfolioOwnerAccess} from './portfolio-owner-access.ts';
import {execFile} from 'node:child_process';

try {
  const links = await refreshPortfolioOwnerAccess();
  if (!process.argv.includes('--no-open') && !process.argv.includes('file-only') && process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:VITRIS_PREVIEW_SIGNIN'], {windowsHide: true, env: {...process.env, VITRIS_PREVIEW_SIGNIN: links.url}}, error => error ? reject(error) : resolve()));
    console.log('Opening a fresh private owner sign-in. Choose Continue to workspace in that tab.');
  } else console.log('Fresh private owner sign-in saved to .vitris/portfolio-owner.json.');
  console.log('Existing test records are preserved. No email is sent.');
} catch (error) {console.error(error instanceof Error ? error.message : 'Unable to refresh local preview sign-in.'); process.exitCode = 1;}
