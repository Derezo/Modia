#!/usr/bin/env node

import { reportCliFailure, runStage } from './template-cli.mjs';

runStage().catch(error => reportCliFailure('Battle-map template staging', error));
