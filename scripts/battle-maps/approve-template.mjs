#!/usr/bin/env node

import { reportCliFailure, runApprove } from './template-cli.mjs';

runApprove().catch(error => reportCliFailure('Battle-map template approval', error));
