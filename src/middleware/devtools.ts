import type { ScopeTemplate } from '../core/value-scope.js';
import type { ScopeMap } from '../core/scope-map.js';
import type { Value } from '../core/value.js';
import type { GenericScopeInstance } from '../core/scope-types.js';
import type { Change, Unsubscribe } from '../core/types.js';

// --- Redux DevTools Extension types ---

interface ReduxDevtoolsExtension {
	connect(options: { name: string; maxAge?: number }): DevtoolsConnection;
}

interface DevtoolsConnection {
	init(state: unknown): void;
	send(action: { type: string; payload?: unknown }, state: unknown): void;
	subscribe(
		listener: (message: {
			type: string;
			state?: string;
			payload?: { type: string };
		}) => void,
	): (() => void) | undefined;
	unsubscribe(): void;
}

declare const globalThis: {
	__REDUX_DEVTOOLS_EXTENSION__?: ReduxDevtoolsExtension;
};

/** Options shared by all devtools connectors. */
export interface DevtoolsOptions {
	/** Name shown in the DevTools instance selector. Required. */
	name: string;

	/** Maximum number of actions to keep in the timeline. Default: 50. */
	maxAge?: number;

	/** Filter which fields appear in state. Default: all. */
	fields?: string[];

	/** Disable in production. Default: true (disabled when NODE_ENV === 'production'). */
	enabled?: boolean;

	/**
	 * Transform a snapshot into a JSON-safe form before sending to DevTools.
	 * Use this to encode values that don't round-trip through `JSON.stringify`
	 * (Date, Map, Set, BigInt, custom classes). Paired with `deserialize` to
	 * restore the encoded values on time travel.
	 *
	 * @default identity
	 */
	serialize?: (snapshot: Record<string, unknown>) => Record<string, unknown>;

	/**
	 * Inverse of {@link DevtoolsOptions.serialize}. Converts the JSON-parsed
	 * state coming back from DevTools time travel into the form your scope
	 * understands. Applied before `$setSnapshot`.
	 *
	 * @default identity
	 */
	deserialize?: (raw: Record<string, unknown>) => Record<string, unknown>;
}

function identitySnapshot(
	snapshot: Record<string, unknown>,
): Record<string, unknown> {
	return snapshot;
}

// --- Helpers ---

function getExtension(): ReduxDevtoolsExtension | undefined {
	if (typeof globalThis === 'undefined') return undefined;
	return globalThis.__REDUX_DEVTOOLS_EXTENSION__;
}

function isEnabled(options: DevtoolsOptions): boolean {
	if (options.enabled === false) return false;
	if (options.enabled === true) return true;
	// Default: disabled in production
	try {
		return (
			typeof globalThis === 'undefined' ||
			!('process' in globalThis) ||
			(
				globalThis as unknown as {
					process: { env: Record<string, string> };
				}
			).process.env.NODE_ENV !== 'production'
		);
	} catch {
		return true;
	}
}

function filterSnapshot(
	snapshot: Record<string, unknown>,
	fields: string[] | undefined,
): Record<string, unknown> {
	if (!fields) return snapshot;
	const filtered: Record<string, unknown> = {};
	for (const field of fields) {
		if (field in snapshot) {
			filtered[field] = snapshot[field];
		}
	}
	return filtered;
}

function buildActionName(changes: Set<Change>): string {
	const keys = [...changes].map((change) => change.path);
	return `set:${keys.join(',')}`;
}

function buildSetPayload(
	changes: Set<Change>,
): Record<string, { from: unknown; to: unknown }> {
	const payload: Record<string, { from: unknown; to: unknown }> = {};
	for (const change of changes) {
		payload[change.path] = { from: change.from, to: change.to };
	}
	return payload;
}

/**
 * Per-instance devtools connection, keyed by scope instance.
 * Using a WeakMap avoids polluting the instance with a `__devtools` property.
 */
const connectionByInstance = new WeakMap<object, DevtoolsConnection>();

// --- withDevtools ---

/**
 * Wrap a scope template with Redux DevTools integration.
 *
 * Returns a new template that sends state snapshots and action names
 * to the Redux DevTools Extension on every change.
 *
 * @param template - the scope template to instrument.
 * @param options - devtools options (name is required).
 * @returns a new ScopeTemplate with devtools wired in.
 */
export function withDevtools<Def extends Record<string, unknown>>(
	template: ScopeTemplate<Def>,
	options: DevtoolsOptions,
): ScopeTemplate<Def> {
	if (!isEnabled(options)) return template;

	const extension = getExtension();
	if (!extension) return template;

	const serialize = options.serialize ?? identitySnapshot;
	const deserialize = options.deserialize ?? identitySnapshot;

	return template.extend(
		{},
		{
			onCreate({ scope }) {
				const connection = extension.connect({
					name: options.name,
					maxAge: options.maxAge ?? 50,
				});

				const initialState = serialize(
					filterSnapshot(scope.$getSnapshot(), options.fields),
				);
				connection.init(initialState);

				// Store connection on the scope for onChange to use
				connectionByInstance.set(scope, connection);

				// Time travel support
				connection.subscribe((message) => {
					if (message.type === 'DISPATCH' && message.state) {
						const historicalState = JSON.parse(message.state) as Record<
							string,
							unknown
						>;
						scope.$setSnapshot(deserialize(historicalState));
					}
				});
			},

			onChange({ scope, changes }) {
				const connection = connectionByInstance.get(scope);
				if (!connection) return;

				const actionName = buildActionName(changes);
				const payload = buildSetPayload(changes);
				const state = serialize(
					filterSnapshot(
						(scope as unknown as GenericScopeInstance).$getSnapshot(),
						options.fields,
					),
				);

				connection.send({ type: actionName, payload }, state);
			},

			onDestroy({ scope }) {
				const connection = connectionByInstance.get(scope);
				if (connection) {
					connection.unsubscribe();
					connectionByInstance.delete(scope);
				}
			},
		},
	);
}

// --- connectMapDevtools ---

/**
 * Connect a ScopeMap to Redux DevTools.
 *
 * Subscribes to key-list changes and per-instance field changes, sending
 * the full map snapshot to the DevTools timeline on every update.
 *
 * @param map - the ScopeMap to instrument.
 * @param options - devtools options (name is required).
 * @returns a disconnect function that tears down all subscriptions.
 */
export function connectMapDevtools<
	K extends string | number,
	Def extends Record<string, unknown>,
>(map: ScopeMap<K, Def>, options: DevtoolsOptions): Unsubscribe {
	if (!isEnabled(options)) return () => {};

	const extension = getExtension();
	if (!extension) return () => {};

	const serialize = options.serialize ?? identitySnapshot;
	const deserialize = options.deserialize ?? identitySnapshot;

	const connection = extension.connect({
		name: options.name,
		maxAge: options.maxAge ?? 50,
	});

	const instanceSubscriptions = new Map<K, Unsubscribe>();

	function getMapSnapshot(): Record<string, unknown> {
		const keys = map.keys();
		const snapshot: Record<string, unknown> = {
			_keys: keys,
		};
		for (const key of keys) {
			const instance = map.get(key);
			if (instance) {
				const instanceSnapshot = instance.$getSnapshot() as Record<
					string,
					unknown
				>;
				snapshot[String(key)] =
					options.fields ?
						filterSnapshot(instanceSnapshot, options.fields)
					:	instanceSnapshot;
			}
		}
		return serialize(snapshot);
	}

	function sendState(actionType: string, payload?: unknown): void {
		const state = getMapSnapshot();
		connection.send(
			{ type: actionType, ...(payload !== undefined ? { payload } : {}) },
			state,
		);
	}

	function subscribeToInstance(key: K): void {
		const instance = map.get(key);
		if (!instance) return;

		const unsub = instance.$subscribe(() => {
			// Get the instance snapshot to figure out what changed
			sendState(`instance:${String(key)}`);
		});
		instanceSubscriptions.set(key, unsub);
	}

	// Initialize
	const initialState = getMapSnapshot();
	connection.init(initialState);

	// Subscribe to existing instances
	for (const key of map.keys()) {
		subscribeToInstance(key);
	}

	// Track previous keys to detect adds/removes
	let previousKeys = new Set(map.keys());

	// Subscribe to key-list changes
	const unsubKeys = map.subscribe((keys) => {
		const currentKeys = new Set(keys);

		// Find added keys
		for (const key of currentKeys) {
			if (!previousKeys.has(key)) {
				const instance = map.get(key);
				sendState(
					`add:${String(key)}`,
					instance ? { input: instance.$getSnapshot() } : undefined,
				);
				subscribeToInstance(key);
			}
		}

		// Find removed keys
		for (const key of previousKeys) {
			if (!currentKeys.has(key)) {
				const unsub = instanceSubscriptions.get(key);
				if (unsub) {
					unsub();
					instanceSubscriptions.delete(key);
				}
				sendState(`delete:${String(key)}`);
			}
		}

		previousKeys = currentKeys;
	});

	// Time travel support
	const unsubDevtools = connection.subscribe((message) => {
		if (message.type === 'DISPATCH' && message.state) {
			const historicalState = deserialize(
				JSON.parse(message.state) as Record<string, unknown>,
			);
			const historicalKeys = (historicalState._keys ?? []) as K[];
			const currentKeys = new Set(map.keys());
			const targetKeys = new Set(historicalKeys);

			// Remove keys not in historical state
			for (const key of currentKeys) {
				if (!targetKeys.has(key)) {
					map.delete(key);
				}
			}

			// Add missing keys and update existing
			for (const key of historicalKeys) {
				const data = historicalState[String(key)] as
					| Record<string, unknown>
					| undefined;
				if (!currentKeys.has(key)) {
					map.set(key, data as never);
				} else if (data) {
					const instance = map.get(key);
					if (instance) {
						instance.$setSnapshot(data as never);
					}
				}
			}
		}
	});

	return () => {
		unsubKeys();
		for (const [, unsub] of instanceSubscriptions) {
			unsub();
		}
		instanceSubscriptions.clear();
		unsubDevtools?.();
		connection.unsubscribe();
	};
}

// --- connectDevtools ---

/**
 * Connect a standalone Value to Redux DevTools.
 *
 * Subscribes to the value and dispatches `set` actions with `{ value }` payload.
 *
 * @param val - the Value to instrument.
 * @param options - devtools options (name is required).
 * @returns a disconnect function.
 */
export function connectDevtools<In, Out>(
	val: Value<In, Out>,
	options: DevtoolsOptions,
): Unsubscribe {
	if (!isEnabled(options)) return () => {};

	const extension = getExtension();
	if (!extension) return () => {};

	const connection = extension.connect({
		name: options.name,
		maxAge: options.maxAge ?? 50,
	});

	connection.init({ value: val.get() });

	const unsubValue = val.subscribe((current, previous) => {
		connection.send(
			{ type: 'set', payload: { from: previous, to: current } },
			{ value: current },
		);
	});

	// Time travel support
	const unsubDevtools = connection.subscribe((message) => {
		if (message.type === 'DISPATCH' && message.state) {
			const historicalState = JSON.parse(message.state) as {
				value: In;
			};
			val.set(historicalState.value);
		}
	});

	return () => {
		unsubValue();
		unsubDevtools?.();
		connection.unsubscribe();
	};
}
