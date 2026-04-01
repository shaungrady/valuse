import { useSyncExternalStore } from 'react';
import { installReact } from '../core/react-bridge.js';

// Side-effect: install React's useSyncExternalStore into the bridge.
// This enables .use() hooks on all reactive types.
installReact({ useSyncExternalStore });
