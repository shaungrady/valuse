import { describe, it, expect } from 'vitest';
import { render, act, screen, waitFor } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { type } from 'arktype';

// Install React bridge before importing v2 modules
import { installReact } from '../core/react-bridge.js';
installReact({ useSyncExternalStore });

import { value } from '../core/value.js';
import { valueScope } from '../core/value-scope.js';
import { valueArray } from '../core/value-array.js';
import { valueSet } from '../core/value-set.js';
import { valueMap } from '../core/value-map.js';
import { valueSchema } from '../core/value-schema.js';
import { valueRef } from '../core/value-ref.js';

describe('React hooks via .use() (v2)', () => {
	describe('FieldValue.use()', () => {
		it('renders the initial value', () => {
			const person = valueScope({ name: value('Alice') });
			const instance = person.create({ name: 'Alice' });
			function App() {
				const [name] = (instance.name as any).use();
				return <span data-testid="val">{name}</span>;
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('Alice');
		});

		it('re-renders when the value changes', () => {
			const person = valueScope({ name: value<string>() });
			const instance = person.create({ name: 'Alice' });
			function App() {
				const [name] = (instance.name as any).use();
				return <span data-testid="val">{name}</span>;
			}
			render(<App />);
			act(() => (instance.name as any).set('Bob'));
			expect(screen.getByTestId('val').textContent).toBe('Bob');
		});

		it('setter from .use() updates the value', () => {
			const counter = valueScope({ count: value(0) });
			const instance = counter.create();
			function App() {
				const [count, setCount] = (instance.count as any).use();
				return (
					<button data-testid="btn" onClick={() => setCount(count + 1)}>
						{count}
					</button>
				);
			}
			render(<App />);
			act(() => screen.getByTestId('btn').click());
			expect(screen.getByTestId('btn').textContent).toBe('1');
		});

		it('setter accepts a callback', () => {
			const counter = valueScope({ count: value(10) });
			const instance = counter.create();
			function App() {
				const [count, setCount] = (instance.count as any).use();
				return (
					<button
						data-testid="btn"
						onClick={() => setCount((prev: number) => prev + 1)}
					>
						{count}
					</button>
				);
			}
			render(<App />);
			act(() => screen.getByTestId('btn').click());
			expect(screen.getByTestId('btn').textContent).toBe('11');
		});
	});

	describe('FieldDerived.use()', () => {
		it('renders a derived value', () => {
			const person = valueScope({
				firstName: value('Alice'),
				lastName: value('Smith'),
				fullName: ({ scope }: { scope: any }) =>
					`${scope.firstName.use()} ${scope.lastName.use()}`,
			});
			const instance = person.create();
			function App() {
				const [fullName] = (instance.fullName as any).use();
				return <span data-testid="val">{fullName}</span>;
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('Alice Smith');
		});

		it('re-renders when a dependency changes', () => {
			const person = valueScope({
				firstName: value('Alice'),
				lastName: value('Smith'),
				fullName: ({ scope }: { scope: any }) =>
					`${scope.firstName.use()} ${scope.lastName.use()}`,
			});
			const instance = person.create();
			function App() {
				const [fullName] = (instance.fullName as any).use();
				return <span data-testid="val">{fullName}</span>;
			}
			render(<App />);
			act(() => (instance.firstName as any).set('Bob'));
			expect(screen.getByTestId('val').textContent).toBe('Bob Smith');
		});
	});

	describe('per-field render optimization', () => {
		it('only re-renders when the subscribed field changes', () => {
			const person = valueScope({
				name: value('Alice'),
				age: value(30),
			});
			const instance = person.create();
			let renderCount = 0;

			function NameDisplay() {
				const [name] = (instance.name as any).use();
				renderCount++;
				return <span data-testid="val">{name}</span>;
			}
			render(<NameDisplay />);
			expect(renderCount).toBe(1);

			// Changing a different field should NOT re-render
			act(() => (instance.age as any).set(31));
			expect(renderCount).toBe(1);

			// Changing the subscribed field SHOULD re-render
			act(() => (instance.name as any).set('Bob'));
			expect(renderCount).toBe(2);
		});
	});

	describe('$use()', () => {
		it('returns a reactive snapshot', () => {
			const person = valueScope({
				name: value('Alice'),
				age: value(30),
			});
			const instance = person.create();
			function App() {
				const [snapshot] = (instance as any).$use();
				return (
					<span data-testid="val">
						{snapshot.name},{snapshot.age}
					</span>
				);
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('Alice,30');
		});

		it('re-renders on any field change', () => {
			const person = valueScope({
				name: value('Alice'),
				age: value(30),
			});
			const instance = person.create();
			function App() {
				const [snapshot] = (instance as any).$use();
				return <span data-testid="val">{snapshot.name}</span>;
			}
			render(<App />);
			act(() => (instance.name as any).set('Bob'));
			expect(screen.getByTestId('val').textContent).toBe('Bob');
		});

		it('returns a stable snapshot reference when nothing changed', () => {
			const person = valueScope({
				name: value('Alice'),
				age: value(30),
			});
			const instance = person.create() as unknown as {
				$getSnapshot: () => Record<string, unknown>;
				name: { set: (v: string) => void };
			};

			const first = instance.$getSnapshot();
			const second = instance.$getSnapshot();
			expect(second).toBe(first);

			instance.name.set('Bob');
			const third = instance.$getSnapshot();
			expect(third).not.toBe(first);
			expect(third.name).toBe('Bob');

			const fourth = instance.$getSnapshot();
			expect(fourth).toBe(third);
		});
	});

	describe('ValueArray.use()', () => {
		it('renders the array', () => {
			const arr = valueArray(['a', 'b', 'c']);
			function App() {
				const [items] = arr.use();
				return <span data-testid="val">{items.join(',')}</span>;
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('a,b,c');
		});

		it('re-renders on push', () => {
			const arr = valueArray(['a']);
			function App() {
				const [items] = arr.use();
				return <span data-testid="val">{items.join(',')}</span>;
			}
			render(<App />);
			act(() => arr.push('b'));
			expect(screen.getByTestId('val').textContent).toBe('a,b');
		});

		it('use(index) returns element at index', () => {
			const arr = valueArray(['Alice', 'Bob']);
			function App() {
				const [first] = arr.use(0);
				return <span data-testid="val">{first}</span>;
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('Alice');
			act(() => arr.set(0, 'Alicia'));
			expect(screen.getByTestId('val').textContent).toBe('Alicia');
		});
	});

	describe('ValueSet.use()', () => {
		it('renders the current set', () => {
			const tags = valueSet<string>(['a', 'b']);
			function App() {
				const [s] = tags.use();
				return <span data-testid="val">{[...s].join(',')}</span>;
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('a,b');
		});

		it('re-renders on draft mutation', () => {
			const tags = valueSet<string>(['a']);
			function App() {
				const [s] = tags.use();
				return <span data-testid="val">{[...s].join(',')}</span>;
			}
			render(<App />);
			act(() => tags.set((draft) => draft.add('b')));
			expect(screen.getByTestId('val').textContent).toBe('a,b');
		});
	});

	describe('ValueMap.use()', () => {
		it('renders the full map', () => {
			const scores = valueMap<string, number>([['alice', 95]]);
			function App() {
				const [m] = scores.use();
				return <span data-testid="val">{m.get('alice')}</span>;
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('95');
		});

		it('re-renders on map change', () => {
			const scores = valueMap<string, number>([['alice', 95]]);
			function App() {
				const [m] = scores.use();
				return <span data-testid="val">{m.get('alice')}</span>;
			}
			render(<App />);
			act(() => scores.set((draft) => draft.set('alice', 100)));
			expect(screen.getByTestId('val').textContent).toBe('100');
		});

		it('per-key .use(key) returns [value, setter]', () => {
			const scores = valueMap<string, number>([
				['alice', 95],
				['bob', 82],
			]);
			function App() {
				const [aliceScore, setAlice] = scores.use('alice');
				return (
					<>
						<span data-testid="val">{aliceScore}</span>
						<button onClick={() => setAlice(100)}>update</button>
					</>
				);
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('95');
			act(() => screen.getByRole('button').click());
			expect(screen.getByTestId('val').textContent).toBe('100');
		});

		it('per-key .use(key) does NOT re-render when a different key changes', () => {
			const scores = valueMap<string, number>([
				['alice', 95],
				['bob', 82],
			]);
			let aliceRenders = 0;
			function AliceComponent() {
				const [aliceScore] = scores.use('alice');
				aliceRenders++;
				return <span data-testid="alice">{aliceScore}</span>;
			}
			render(<AliceComponent />);
			expect(aliceRenders).toBe(1);
			// Changing bob should NOT re-render alice
			act(() => scores.set((draft) => draft.set('bob', 99)));
			expect(aliceRenders).toBe(1);
			// Changing alice SHOULD re-render
			act(() => scores.set((draft) => draft.set('alice', 100)));
			expect(aliceRenders).toBe(2);
			expect(screen.getByTestId('alice').textContent).toBe('100');
		});

		it('useKeys() returns reactive key list', () => {
			const scores = valueMap<string, number>([['alice', 95]]);
			function App() {
				const keys = scores.useKeys();
				return <span data-testid="val">{keys.join(',')}</span>;
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('alice');
			act(() => scores.set((draft) => draft.set('bob', 82)));
			expect(screen.getByTestId('val').textContent).toBe('alice,bob');
		});
	});

	describe('ScopeMap.useKeys()', () => {
		it('re-renders when collection changes', () => {
			const person = valueScope({
				firstName: value<string>(),
				lastName: value<string>(),
			});
			const people = person.createMap();
			people.set('bob', { firstName: 'Bob', lastName: 'Jones' });

			function App() {
				const keys = people.useKeys();
				return <span data-testid="val">{keys.join(',')}</span>;
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('bob');
			act(() => people.set('alice', { firstName: 'Alice', lastName: 'Smith' }));
			expect(screen.getByTestId('val').textContent).toBe('bob,alice');
		});
	});

	describe('FieldValueSchema.use() with React', () => {
		it('renders schema-validated value and re-renders on set', () => {
			const Email = type('string.email');
			const scope = valueScope({
				email: valueSchema(Email, ''),
			});
			const instance = scope.create();
			function App() {
				const [email, setEmail] = (instance.email as any).use();
				return (
					<>
						<span data-testid="val">{email}</span>
						<button
							data-testid="btn"
							onClick={() => setEmail('alice@example.com')}
						>
							set
						</button>
					</>
				);
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('');
			act(() => screen.getByTestId('btn').click());
			expect(screen.getByTestId('val').textContent).toBe('alice@example.com');
		});
	});

	describe('FieldValueSchema.useValidation() with React', () => {
		it('renders validation state and re-renders on change', () => {
			const Email = type('string.email');
			const scope = valueScope({
				email: valueSchema(Email, ''),
			});
			const instance = scope.create();
			function App() {
				const [email, setEmail, validation] = (
					instance.email as any
				).useValidation();
				return (
					<>
						<span data-testid="val">{email}</span>
						<span data-testid="valid">{String(validation.isValid)}</span>
						<span data-testid="issues">{validation.issues.length}</span>
						<button
							data-testid="good"
							onClick={() => setEmail('alice@example.com')}
						>
							good
						</button>
						<button data-testid="bad" onClick={() => setEmail('not-an-email')}>
							bad
						</button>
					</>
				);
			}
			render(<App />);
			// Initial empty string is invalid for email
			expect(screen.getByTestId('valid').textContent).toBe('false');

			act(() => screen.getByTestId('good').click());
			expect(screen.getByTestId('val').textContent).toBe('alice@example.com');
			expect(screen.getByTestId('valid').textContent).toBe('true');
			expect(screen.getByTestId('issues').textContent).toBe('0');

			act(() => screen.getByTestId('bad').click());
			expect(screen.getByTestId('val').textContent).toBe('not-an-email');
			expect(screen.getByTestId('valid').textContent).toBe('false');
		});
	});

	describe('FieldAsyncDerived.useAsync() with React', () => {
		it('renders async state transitions', async () => {
			const scope = valueScope({
				query: value<string>('hello'),
				result: async ({ scope: s }: { scope: any }) => {
					const q = s.query.use();
					return `result for ${q}`;
				},
			});
			const instance = scope.create({ query: 'hello' });
			function App() {
				const [val, asyncState] = (instance.result as any).useAsync();
				return (
					<>
						<span data-testid="val">{val ?? 'undefined'}</span>
						<span data-testid="status">{asyncState.status}</span>
					</>
				);
			}
			render(<App />);
			// Initially setting (async derivation starts immediately)
			expect(screen.getByTestId('val').textContent).toBe('undefined');
			expect(screen.getByTestId('status').textContent).toBe('setting');

			// Wait for async resolution
			await waitFor(() => {
				expect(screen.getByTestId('status').textContent).toBe('set');
			});
			expect(screen.getByTestId('val').textContent).toBe('result for hello');
		});

		it('re-renders when dependency changes', async () => {
			const scope = valueScope({
				query: value<string>('a'),
				result: async ({ scope: s }: { scope: any }) => {
					const q = s.query.use();
					return `fetched ${q}`;
				},
			});
			const instance = scope.create({ query: 'a' });
			function App() {
				const [val, asyncState] = (instance.result as any).useAsync();
				return (
					<>
						<span data-testid="val">{val ?? 'undefined'}</span>
						<span data-testid="status">{asyncState.status}</span>
					</>
				);
			}
			render(<App />);

			await waitFor(() => {
				expect(screen.getByTestId('val').textContent).toBe('fetched a');
			});

			act(() => (instance.query as any).set('b'));

			await waitFor(() => {
				expect(screen.getByTestId('val').textContent).toBe('fetched b');
			});
		});
	});

	describe('$useIsValid with React', () => {
		it('renders validity and re-renders on validation change', () => {
			const Email = type('string.email');
			const scope = valueScope({
				email: valueSchema(Email, 'alice@example.com'),
			});
			const instance = scope.create();
			function App() {
				const isValid = (instance as any).$useIsValid();
				return <span data-testid="val">{String(isValid)}</span>;
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('true');

			act(() => (instance.email as any).set('bad'));
			expect(screen.getByTestId('val').textContent).toBe('false');

			act(() => (instance.email as any).set('bob@example.com'));
			expect(screen.getByTestId('val').textContent).toBe('true');
		});

		it('works with validate hook', () => {
			const scope = valueScope(
				{
					password: value<string>(),
					confirm: value<string>(),
				},
				{
					validate: ({ scope: s }: { scope: any }) => {
						const issues: { message: string; path: PropertyKey[] }[] = [];
						if (s.password.use() !== s.confirm.use()) {
							issues.push({
								message: 'Passwords must match',
								path: ['confirm'],
							});
						}
						return issues;
					},
				},
			);
			const instance = scope.create({ password: 'abc', confirm: 'abc' });
			function App() {
				const isValid = (instance as any).$useIsValid();
				return <span data-testid="val">{String(isValid)}</span>;
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('true');

			act(() => (instance.confirm as any).set('xyz'));
			expect(screen.getByTestId('val').textContent).toBe('false');

			act(() => (instance.confirm as any).set('abc'));
			expect(screen.getByTestId('val').textContent).toBe('true');
		});
	});

	describe('$useIsValid({ deep: true }) with React', () => {
		it('re-renders when a nested valueRef scope field flips validity', () => {
			const Address = type('5 <= string <= 5');
			const address = valueScope({ zip: valueSchema(Address, '12345') });
			const person = valueScope({
				name: valueSchema(type('string > 0'), 'Alice'),
				address: valueRef(() => address.create()),
			});
			const instance = person.create();
			function App() {
				const isValid = (instance as any).$useIsValid({ deep: true });
				return <span data-testid="val">{String(isValid)}</span>;
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('true');

			act(() => (instance.address as any).zip.set('bad'));
			expect(screen.getByTestId('val').textContent).toBe('false');

			act(() => (instance.address as any).zip.set('98765'));
			expect(screen.getByTestId('val').textContent).toBe('true');
		});

		it('re-renders when a ScopeMap entry is added with an invalid field', () => {
			const card = valueScope({
				title: valueSchema(type('string > 0'), ''),
			});
			const board = valueScope({
				name: valueSchema(type('string > 0'), 'Board'),
				cards: valueRef(() => card.createMap()),
			});
			const instance = board.create();
			function App() {
				const isValid = (instance as any).$useIsValid({ deep: true });
				return <span data-testid="val">{String(isValid)}</span>;
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('true');

			act(() => (instance.cards as any).set('c1', { title: '' }));
			expect(screen.getByTestId('val').textContent).toBe('false');

			act(() => (instance.cards as any).get('c1').title.set('Buy milk'));
			expect(screen.getByTestId('val').textContent).toBe('true');

			act(() => (instance.cards as any).set('c2', { title: '' }));
			expect(screen.getByTestId('val').textContent).toBe('false');

			act(() => (instance.cards as any).delete('c2'));
			expect(screen.getByTestId('val').textContent).toBe('true');
		});
	});

	describe('$useValidation with React', () => {
		it('re-renders with prefixed issues when a field flips invalid', () => {
			const Email = type('string.email');
			const scope = valueScope({
				email: valueSchema(Email, 'alice@example.com'),
			});
			const instance = scope.create();
			function App() {
				const result = (instance as any).$useValidation();
				return (
					<span data-testid="val">
						{String(result.isValid)}|{result.issues.length}|
						{result.issues[0]?.path?.[0] ?? ''}
					</span>
				);
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('true|0|');

			act(() => (instance.email as any).set('bad'));
			const text = screen.getByTestId('val').textContent;
			expect(text).toMatch(/^false\|/);
			expect(text).toMatch(/\|email$/);
		});

		it('deep: true re-renders with prefixed nested issues', () => {
			const Address = type('5 <= string <= 5');
			const address = valueScope({ zip: valueSchema(Address, '12345') });
			const person = valueScope({
				name: valueSchema(type('string > 0'), 'Alice'),
				address: valueRef(() => address.create()),
			});
			const instance = person.create();
			function App() {
				const result = (instance as any).$useValidation({ deep: true });
				const path = result.issues[0]?.path?.join('.') ?? '';
				return (
					<span data-testid="val">
						{String(result.isValid)}|{path}
					</span>
				);
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('true|');

			act(() => (instance.address as any).zip.set('bad'));
			expect(screen.getByTestId('val').textContent).toBe('false|address.zip');

			act(() => (instance.address as any).zip.set('98765'));
			expect(screen.getByTestId('val').textContent).toBe('true|');
		});

		it('deep: true re-renders when a ScopeMap entry is added/removed', () => {
			const card = valueScope({
				title: valueSchema(type('string > 0'), ''),
			});
			const board = valueScope({
				name: valueSchema(type('string > 0'), 'Board'),
				cards: valueRef(() => card.createMap()),
			});
			const instance = board.create();
			function App() {
				const result = (instance as any).$useValidation({ deep: true });
				const path = result.issues[0]?.path?.join('.') ?? '';
				return (
					<span data-testid="val">
						{String(result.isValid)}|{path}
					</span>
				);
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('true|');

			act(() => (instance.cards as any).set('c1', { title: '' }));
			expect(screen.getByTestId('val').textContent).toBe(
				'false|cards.c1.title',
			);

			act(() => (instance.cards as any).get('c1').title.set('Buy milk'));
			expect(screen.getByTestId('val').textContent).toBe('true|');
		});
	});

	describe('derivation through a ref .use()', () => {
		it('re-renders when a ScopeMap ref gains or loses entries', () => {
			const column = valueScope({ name: value<string>() });
			const board = valueScope({
				columns: valueRef(() => column.createMap()),
				columnCount: ({ scope }: { scope: any }) => scope.columns.use().size,
			});
			const instance = board.create();
			function App() {
				const count = (instance.columnCount as any).use();
				return <span data-testid="val">{String(count)}</span>;
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('0');

			act(() => (instance as any).columns.set('a', { name: 'Alpha' }));
			expect(screen.getByTestId('val').textContent).toBe('1');

			act(() => (instance as any).columns.set('b', { name: 'Beta' }));
			expect(screen.getByTestId('val').textContent).toBe('2');

			act(() => (instance as any).columns.delete('a'));
			expect(screen.getByTestId('val').textContent).toBe('1');
		});

		it('re-renders when a shared scope-instance ref field mutates', () => {
			const user = valueScope({ name: value<string>('Alice') });
			const sharedUser = user.create();
			const app = valueScope({
				currentUser: valueRef(sharedUser),
				greeting: ({ scope }: { scope: any }) =>
					`Hi ${scope.currentUser.use().name.get()}`,
			});
			const instance = app.create();
			function App() {
				const greeting = (instance.greeting as any).use();
				return <span data-testid="val">{greeting}</span>;
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('Hi Alice');

			act(() => sharedUser.name.set('Bob'));
			expect(screen.getByTestId('val').textContent).toBe('Hi Bob');
		});
	});
});
