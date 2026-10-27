import * as direct from './fixtures/value.mjs';
import * as normalized from './fixtures/../fixtures/value.mjs';
import { check, result } from './fixtures/result.mjs';

check(direct === normalized, 'Internal parent segments must share an ESM module instance');
result({ sameModule: direct === normalized, sameDefault: direct.default === normalized.default });
