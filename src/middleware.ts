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

export { localStorageAdapter } from './middleware/persistence/local-storage-adapter.js';
export { sessionStorageAdapter } from './middleware/persistence/session-storage-adapter.js';
export { indexedDBAdapter } from './middleware/persistence/indexed-db-adapter.js';
export type { IndexedDBAdapterOptions } from './middleware/persistence/indexed-db-adapter.js';

export { withHistory } from './middleware/history.js';
export type {
	HistoryOptions,
	HistoryInstance,
	HistoryTemplate,
} from './middleware/history.js';

export { withActions } from './middleware/actions.js';
export type {
	ActionContext,
	ActionLayer,
	ActionMembers,
} from './middleware/actions.js';
