// Grouped re-export of all middleware.

export {
	withDevtools,
	connectMapDevtools,
	connectDevtools,
} from './middleware/devtools.js';
export type { DevtoolsOptions } from './middleware/devtools.js';

export { withPersistence } from './middleware/persistence/persistence.js';
export type {
	PersistenceAdapter,
	PersistenceOptions,
} from './middleware/persistence/persistence.js';

export { localStorageAdapter } from './middleware/persistence/localStorageAdapter.js';
export { sessionStorageAdapter } from './middleware/persistence/sessionStorageAdapter.js';
export { indexedDBAdapter } from './middleware/persistence/indexedDBAdapter.js';
export type { IndexedDBAdapterOptions } from './middleware/persistence/indexedDBAdapter.js';

export { withHistory } from './middleware/history.js';
export type {
	HistoryOptions,
	HistoryInstance,
	HistoryTemplate,
} from './middleware/history.js';
