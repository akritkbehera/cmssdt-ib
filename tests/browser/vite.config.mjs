import { mergeConfig } from 'vite';
import base from '../../vite.config.js';
export default mergeConfig(base, {
  resolve: { alias: [{find:/.*Utils\/ajax$/, replacement:new URL('./ajax.js', import.meta.url).pathname}, {find:/.*context\/ShowArchContext$/, replacement:new URL('./context.js', import.meta.url).pathname}] }
});
