#!/usr/bin/env node
import {run} from '@vitris/admin/cli';
await run(['init',...process.argv.slice(2)]);
