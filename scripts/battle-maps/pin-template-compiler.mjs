#!/usr/bin/env node

import { reportCliFailure, runPinCompiler } from './template-cli.mjs';

runPinCompiler().catch(error => (
  reportCliFailure('Battle-map template compiler pin', error)
));
