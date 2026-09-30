import 'server-only';

import type { FactoryControlState } from '@/lib/factory-control';
import { checked, db } from './db';


const stageProgress={planning:3,content:8,script:18,voice:26,transcript:34,scenes:42,render:80,quality:94,packaging:97,publish:98,done:100} as const;
