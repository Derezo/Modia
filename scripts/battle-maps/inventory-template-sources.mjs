#!/usr/bin/env node

import { reportCliFailure, runInventory } from './template-cli.mjs';

runInventory().catch(error => reportCliFailure('Battle-map source inventory', error));
