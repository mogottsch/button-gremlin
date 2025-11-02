import type { Command } from '../types/index.js';
import { ping } from './ping.js';
import { play } from './play.js';
import { list } from './list.js';
import { upload } from './upload.js';
import { disconnect } from './disconnect.js';

export const commands: Command[] = [ping, play, list, upload, disconnect];

