#!/usr/bin/env node
import {run} from '@tryvitris/website-admin-harness/cli';
await run(['init',...process.argv.slice(2)]);
