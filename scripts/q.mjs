import { rows } from '../lib/s2.mjs';
console.log(JSON.stringify(await rows(process.argv[2]), null, 1));
