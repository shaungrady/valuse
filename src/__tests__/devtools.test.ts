import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { value } from '../core/value.js';
import { valueScope } from '../core/value-scope.js';
import {
	withDevtools,
	connectMapDevtools,
	connectDevtools,
} from '../middleware/devtools.js';

// --- Mock Redux DevTools Extension ---

interface MockConnection {
	init: ReturnType<typeof vi.fn>;
	send: ReturnType<typeof vi.fn>;
	subscribe: ReturnType<typeof vi.fn>;
	unsubscribe: ReturnType<typeof vi.fn>;
	_listener:
		| ((message: {
				type: string;
				state?: string;
				payload?: { type: string };
		  }) => void)
		| null;
	_dispatch: (state: Record<string, unknown>) => void;
}

function createMockConnection(): MockConnection {
	const connection: MockConnection = {
		init: vi.fn(),
		send: vi.fn(),
		subscribe: vi.fn((listener) => {
			connection._listener = listener;
			return () => {
				connection._listener = null;
			};
		}),
		unsubscribe: vi.fn(),
		_listener: null,
		_dispatch(state: Record<string, unknown>) {
			this._listener?.({
				type: 'DISPATCH',
				state: JSON.stringify(state),
			});
		},
	};
	return connection;
}

let mockConnection: MockConnection;

beforeEach(() => {
	mockConnection = createMockConnection();
	(globalThis as Record<string, unknown>).__REDUX_DEVTOOLS_EXTENSION__ = {
		connect: vi.fn(() => mockConnection),
	};
});

afterEach(() => {
	delete (globalThis as Record<string, unknown>).__REDUX_DEVTOOLS_EXTENSION__;
});

// --- withDevtools ---

describe('withDevtools', () => {
	it('sends initial state on create', () => {
		const person = valueScope({
			firstName: value<string>(),
			lastName: value<string>(),
		});
		const debugPerson = withDevtools(person, { name: 'person' });
		debugPerson.create({ firstName: 'Alice', lastName: 'Smith' });

		expect(mockConnection.init).toHaveBeenCalledOnce();
		expect(mockConnection.init).toHaveBeenCalledWith({
			firstName: 'Alice',
			lastName: 'Smith',
		});
	});

	it('sends actions on field changes', async () => {
		const person = valueScope({
			firstName: value<string>(),
			lastName: value<string>(),
		});
		const debugPerson = withDevtools(person, { name: 'person' });
		const alice = debugPerson.create({ firstName: 'Alice', lastName: 'Smith' });

		alice.firstName.set('Bob');

		// onChange is batched on a microtask
		await Promise.resolve();

		expect(mockConnection.send).toHaveBeenCalledOnce();
		const [action, state] = mockConnection.send.mock.calls[0]!;
		expect(action.type).toBe('set:firstName');
		expect(action.payload).toEqual({
			firstName: { from: 'Alice', to: 'Bob' },
		});
		expect(state).toEqual({ firstName: 'Bob', lastName: 'Smith' });
	});

	it('sends batched multi-field changes as a single action', async () => {
		const person = valueScope({
			firstName: value<string>(),
			lastName: value<string>(),
		});
		const debugPerson = withDevtools(person, { name: 'person' });
		const alice = debugPerson.create({ firstName: 'Alice', lastName: 'Smith' });

		alice.$setSnapshot({ firstName: 'Bob', lastName: 'Jones' });

		await Promise.resolve();

		expect(mockConnection.send).toHaveBeenCalledOnce();
		const [action] = mockConnection.send.mock.calls[0]!;
		expect(action.type).toContain('firstName');
		expect(action.type).toContain('lastName');
	});

	it('filters state when fields option is set', async () => {
		const person = valueScope({
			firstName: value<string>(),
			lastName: value<string>(),
			secret: value('hidden'),
		});
		const debugPerson = withDevtools(person, {
			name: 'person',
			fields: ['firstName', 'lastName'],
		});
		debugPerson.create({
			firstName: 'Alice',
			lastName: 'Smith',
		});

		expect(mockConnection.init).toHaveBeenCalledWith({
			firstName: 'Alice',
			lastName: 'Smith',
		});
	});

	it('disconnects on destroy', () => {
		const person = valueScope({
			name: value<string>(),
		});
		const debugPerson = withDevtools(person, { name: 'person' });
		const instance = debugPerson.create({ name: 'Alice' });

		instance.$destroy();

		expect(mockConnection.unsubscribe).toHaveBeenCalledOnce();
	});

	it('supports time travel via DISPATCH', () => {
		const person = valueScope({
			firstName: value<string>(),
			lastName: value<string>(),
		});
		const debugPerson = withDevtools(person, { name: 'person' });
		const alice = debugPerson.create({ firstName: 'Alice', lastName: 'Smith' });

		// Simulate time travel
		mockConnection._dispatch({ firstName: 'Bob', lastName: 'Jones' });

		expect(alice.firstName.get()).toBe('Bob');
		expect(alice.lastName.get()).toBe('Jones');
	});

	it('returns the original template when extension is not available', () => {
		delete (globalThis as Record<string, unknown>).__REDUX_DEVTOOLS_EXTENSION__;

		const person = valueScope({ name: value<string>() });
		const result = withDevtools(person, { name: 'person' });

		// Should be same template (no wrapping)
		expect(result).toBe(person);
	});

	it('returns the original template when enabled is false', () => {
		const person = valueScope({ name: value<string>() });
		const result = withDevtools(person, { name: 'person', enabled: false });

		expect(result).toBe(person);
	});

	it('passes maxAge option to the extension', () => {
		const person = valueScope({ name: value<string>() });
		withDevtools(person, { name: 'person', maxAge: 100 }).create({
			name: 'Alice',
		});

		const connectFn = (globalThis as Record<string, unknown>)
			.__REDUX_DEVTOOLS_EXTENSION__ as { connect: ReturnType<typeof vi.fn> };
		expect(connectFn.connect).toHaveBeenCalledWith({
			name: 'person',
			maxAge: 100,
		});
	});

	it('applies serialize on init and on change', async () => {
		const event = valueScope({
			at: value(new Date('2026-01-01T00:00:00Z')),
		});
		const debugEvent = withDevtools(event, {
			name: 'event',
			serialize: (snapshot) => ({
				...snapshot,
				at: (snapshot.at as Date).toISOString(),
			}),
			deserialize: (raw) => ({
				...raw,
				at: new Date(raw.at as string),
			}),
		});
		const instance = debugEvent.create();

		// Initial state is serialized to a JSON-safe form.
		expect(mockConnection.init).toHaveBeenCalledWith({
			at: '2026-01-01T00:00:00.000Z',
		});

		instance.at.set(new Date('2026-06-15T12:00:00Z'));
		await Promise.resolve();

		const [, state] = mockConnection.send.mock.calls[0]!;
		expect(state).toEqual({ at: '2026-06-15T12:00:00.000Z' });
	});

	it('applies deserialize on time travel', () => {
		const event = valueScope({
			at: value(new Date('2026-01-01T00:00:00Z')),
		});
		const debugEvent = withDevtools(event, {
			name: 'event',
			serialize: (snapshot) => ({
				...snapshot,
				at: (snapshot.at as Date).toISOString(),
			}),
			deserialize: (raw) => ({
				...raw,
				at: new Date(raw.at as string),
			}),
		});
		const instance = debugEvent.create();

		// DevTools sends back the JSON-parsed (string) form.
		mockConnection._dispatch({ at: '2026-06-15T12:00:00.000Z' });

		const restored = instance.at.get();
		expect(restored).toBeInstanceOf(Date);
		expect(restored.toISOString()).toBe('2026-06-15T12:00:00.000Z');
	});
});

// --- connectDevtools (standalone Value) ---

describe('connectDevtools', () => {
	it('sends initial state', () => {
		const count = value(0);
		connectDevtools(count, { name: 'count' });

		expect(mockConnection.init).toHaveBeenCalledWith({ value: 0 });
	});

	it('sends set action on value change', () => {
		const count = value(0);
		connectDevtools(count, { name: 'count' });

		count.set(5);

		expect(mockConnection.send).toHaveBeenCalledWith(
			{ type: 'set', payload: { from: 0, to: 5 } },
			{ value: 5 },
		);
	});

	it('supports time travel', () => {
		const count = value(0);
		connectDevtools(count, { name: 'count' });

		count.set(10);
		mockConnection._dispatch({ value: 3 });

		expect(count.get()).toBe(3);
	});

	it('cleans up on disconnect', () => {
		const count = value(0);
		const disconnect = connectDevtools(count, { name: 'count' });

		disconnect();

		// After disconnect, changes should not send to devtools
		mockConnection.send.mockClear();
		count.set(99);
		expect(mockConnection.send).not.toHaveBeenCalled();
		expect(mockConnection.unsubscribe).toHaveBeenCalledOnce();
	});

	it('returns noop when extension is not available', () => {
		delete (globalThis as Record<string, unknown>).__REDUX_DEVTOOLS_EXTENSION__;

		const count = value(0);
		const disconnect = connectDevtools(count, { name: 'count' });

		expect(typeof disconnect).toBe('function');
		disconnect(); // should not throw
	});
});

// --- connectMapDevtools ---

describe('connectMapDevtools', () => {
	it('sends initial map state', () => {
		const person = valueScope({
			firstName: value<string>(),
			lastName: value<string>(),
		});
		const people = person.createMap<string>();
		people.set('alice', { firstName: 'Alice', lastName: 'Smith' });

		connectMapDevtools(people, { name: 'people' });

		expect(mockConnection.init).toHaveBeenCalledWith({
			_keys: ['alice'],
			alice: { firstName: 'Alice', lastName: 'Smith' },
		});
	});

	it('sends add action when a new instance is added', () => {
		const person = valueScope({
			name: value<string>(),
		});
		const people = person.createMap<string>();

		connectMapDevtools(people, { name: 'people' });

		people.set('alice', { name: 'Alice' });

		expect(mockConnection.send).toHaveBeenCalled();
		const [action] = mockConnection.send.mock.calls[0]!;
		expect(action.type).toBe('add:alice');
	});

	it('sends delete action when an instance is removed', () => {
		const person = valueScope({
			name: value<string>(),
		});
		const people = person.createMap<string>();
		people.set('alice', { name: 'Alice' });

		connectMapDevtools(people, { name: 'people' });
		mockConnection.send.mockClear();

		people.delete('alice');

		expect(mockConnection.send).toHaveBeenCalled();
		const calls = mockConnection.send.mock.calls as [
			{ type: string },
			unknown,
		][];
		const deleteCall = calls.find(([action]) => action.type === 'delete:alice');
		expect(deleteCall).toBeDefined();
	});

	it('tracks per-instance changes', async () => {
		const person = valueScope({
			name: value<string>(),
		});
		const people = person.createMap<string>();
		people.set('alice', { name: 'Alice' });

		connectMapDevtools(people, { name: 'people' });
		mockConnection.send.mockClear();

		const alice = people.get('alice')!;
		alice.name.set('Alicia');

		// $subscribe fires on microtask
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(mockConnection.send).toHaveBeenCalled();
		const [action] = mockConnection.send.mock.calls[0]!;
		expect(action.type).toBe('instance:alice');
	});

	it('auto-subscribes to instances added after connect', async () => {
		const person = valueScope({
			name: value<string>(),
		});
		const people = person.createMap<string>();

		connectMapDevtools(people, { name: 'people' });

		people.set('bob', { name: 'Bob' });
		mockConnection.send.mockClear();

		const bob = people.get('bob')!;
		bob.name.set('Bobby');

		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(mockConnection.send).toHaveBeenCalled();
		const [action] = mockConnection.send.mock.calls[0]!;
		expect(action.type).toBe('instance:bob');
	});

	it('supports time travel with reconciliation', () => {
		const person = valueScope({
			name: value<string>(),
		});
		const people = person.createMap<string>();
		people.set('alice', { name: 'Alice' });
		people.set('bob', { name: 'Bob' });

		connectMapDevtools(people, { name: 'people' });

		// Time travel to a state without bob but with alice renamed
		mockConnection._dispatch({
			_keys: ['alice'],
			alice: { name: 'Alicia' },
		});

		expect(people.has('bob')).toBe(false);
		expect(people.get('alice')!.name.get()).toBe('Alicia');
	});

	it('cleans up all subscriptions on disconnect', () => {
		const person = valueScope({
			name: value<string>(),
		});
		const people = person.createMap<string>();
		people.set('alice', { name: 'Alice' });

		const disconnect = connectMapDevtools(people, { name: 'people' });

		disconnect();

		expect(mockConnection.unsubscribe).toHaveBeenCalledOnce();
	});
});
