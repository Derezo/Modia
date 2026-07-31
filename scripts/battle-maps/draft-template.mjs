#!/usr/bin/env node

import { reportCliFailure, runDraft } from './template-cli.mjs';

runDraft().catch(error => reportCliFailure('Battle-map template draft', error));
