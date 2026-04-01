import { describe, it, expect } from 'vitest';
import { render, act, screen } from '@testing-library/react';

// Import from valuse/react to install the bridge
import { value, valueSet, valueMap, valueScope } from '../react.js';

describe('React hooks via .use()', () => {
	describe('Value.use()', () => {
		it('renders the initial value', () => {
			const count = value(0);
			function App() {
				const [c] = count.use();
				return <span data-testid="val">{c}</span>;
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('0');
		});

		it('re-renders when the value changes', () => {
			const count = value(0);
			function App() {
				const [c] = count.use();
				return <span data-testid="val">{c}</span>;
			}
			render(<App />);
			act(() => count.set(5));
			expect(screen.getByTestId('val').textContent).toBe('5');
		});

		it('setter from .use() updates the value', () => {
			const count = value(0);
			function App() {
				const [c, setCount] = count.use();
				return (
					<button data-testid="btn" onClick={() => setCount(c + 1)}>
						{c}
					</button>
				);
			}
			render(<App />);
			act(() => screen.getByTestId('btn').click());
			expect(screen.getByTestId('btn').textContent).toBe('1');
		});

		it('setter accepts a callback', () => {
			const count = value(10);
			function App() {
				const [c, setCount] = count.use();
				return (
					<button
						data-testid="btn"
						onClick={() => setCount((prev) => prev + 1)}
					>
						{c}
					</button>
				);
			}
			render(<App />);
			act(() => screen.getByTestId('btn').click());
			expect(screen.getByTestId('btn').textContent).toBe('11');
		});

		it('handles value<T>() without default', () => {
			const name = value<string>();
			function App() {
				const [n] = name.use();
				return <span data-testid="val">{n ?? 'empty'}</span>;
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('empty');
			act(() => name.set('Alice'));
			expect(screen.getByTestId('val').textContent).toBe('Alice');
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

		it('per-key .use(key) returns [value, setter] tuple', () => {
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

	describe('ScopeInstance.use()', () => {
		it('provides reactive get/set for a scope', () => {
			const counter = valueScope({
				count: value(0),
				doubled: ({ use }) => (use('count') as number) * 2,
			});
			const inst = counter.create();

			function App() {
				const [get, set] = inst.use();
				return (
					<div>
						<span data-testid="count">{get('count')}</span>
						<span data-testid="doubled">{get('doubled')}</span>
						<button
							data-testid="btn"
							onClick={() => set('count', get('count') + 1)}
						>
							inc
						</button>
					</div>
				);
			}
			render(<App />);
			expect(screen.getByTestId('count').textContent).toBe('0');
			expect(screen.getByTestId('doubled').textContent).toBe('0');
			act(() => screen.getByTestId('btn').click());
			expect(screen.getByTestId('count').textContent).toBe('1');
			expect(screen.getByTestId('doubled').textContent).toBe('2');
		});

		it('re-renders when external set() is called', () => {
			const scope = valueScope({ name: value('Alice') });
			const inst = scope.create();

			function App() {
				const [get] = inst.use();
				return <span data-testid="val">{get('name')}</span>;
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('Alice');
			act(() => inst.set('name', 'Bob'));
			expect(screen.getByTestId('val').textContent).toBe('Bob');
		});

		it('use(key) returns [value, setter] for value keys', () => {
			const scope = valueScope({ name: value('Alice'), age: value(30) });
			const inst = scope.create();

			function App() {
				const [name, setName] = inst.use('name');
				return (
					<>
						<span data-testid="val">{name}</span>
						<button onClick={() => setName('Bob')}>rename</button>
					</>
				);
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('Alice');
			act(() => screen.getByRole('button').click());
			expect(screen.getByTestId('val').textContent).toBe('Bob');
		});

		it('use(key) returns [value] for derivations', () => {
			const scope = valueScope({
				firstName: value('Alice'),
				lastName: value('Smith'),
				fullName: ({ use }) => `${use('firstName')} ${use('lastName')}`,
			});
			const inst = scope.create();

			function App() {
				const [fullName] = inst.use('fullName');
				return <span data-testid="val">{fullName}</span>;
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('Alice Smith');
			act(() => inst.set('firstName', 'Bob'));
			expect(screen.getByTestId('val').textContent).toBe('Bob Smith');
		});

		it('use(key) re-renders only when that field changes', () => {
			const scope = valueScope({ name: value('Alice'), age: value(30) });
			const inst = scope.create();
			let renderCount = 0;

			function App() {
				const [name] = inst.use('name');
				renderCount++;
				return <span data-testid="val">{name}</span>;
			}
			render(<App />);
			expect(renderCount).toBe(1);
			// Change a different field — should NOT re-render
			act(() => inst.set('age', 31));
			expect(renderCount).toBe(1);
			// Change the subscribed field — should re-render
			act(() => inst.set('name', 'Bob'));
			expect(renderCount).toBe(2);
		});
	});

	describe('ScopeMap.use()', () => {
		const personScope = valueScope({
			firstName: value<string>(),
			lastName: value<string>(),
			role: value<string>('viewer'),
			fullName: ({ use }) => `${use('firstName')} ${use('lastName')}`,
		});

		it('use(key) provides reactive get/set for an instance', () => {
			const people = personScope.createMap();
			people.set('bob', { firstName: 'Bob', lastName: 'Jones' });

			function App() {
				const [get, set] = people.use('bob');
				return (
					<div>
						<span data-testid="name">{get('fullName')}</span>
						<button
							data-testid="btn"
							onClick={() => set('firstName', 'Robert')}
						>
							rename
						</button>
					</div>
				);
			}
			render(<App />);
			expect(screen.getByTestId('name').textContent).toBe('Bob Jones');
			act(() => screen.getByTestId('btn').click());
			expect(screen.getByTestId('name').textContent).toBe('Robert Jones');
		});

		it('use(key) re-renders when instance changes externally', () => {
			const people = personScope.createMap();
			people.set('bob', { firstName: 'Bob', lastName: 'Jones' });

			function App() {
				const [get] = people.use('bob');
				return <span data-testid="val">{get('firstName')}</span>;
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('Bob');
			act(() => people.get('bob')!.set('firstName', 'Robert'));
			expect(screen.getByTestId('val').textContent).toBe('Robert');
		});

		it('use(key) setter supports bulk set', () => {
			const people = personScope.createMap();
			people.set('bob', { firstName: 'Bob', lastName: 'Jones' });

			function App() {
				const [get, set] = people.use('bob');
				return (
					<div>
						<span data-testid="name">{get('fullName')}</span>
						<button
							data-testid="btn"
							onClick={() => set({ firstName: 'Robert', lastName: 'Smith' })}
						>
							update
						</button>
					</div>
				);
			}
			render(<App />);
			act(() => screen.getByTestId('btn').click());
			expect(screen.getByTestId('name').textContent).toBe('Robert Smith');
		});

		it('use(key, field) returns [value, setter] for value keys', () => {
			const people = personScope.createMap();
			people.set('bob', { firstName: 'Bob', lastName: 'Jones' });

			function App() {
				const [firstName, setFirstName] = people.use('bob', 'firstName');
				return (
					<>
						<span data-testid="val">{firstName as string}</span>
						<button onClick={() => setFirstName('Robert')}>rename</button>
					</>
				);
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('Bob');
			act(() => screen.getByRole('button').click());
			expect(screen.getByTestId('val').textContent).toBe('Robert');
		});

		it('use(key, field) returns [value] for derivations', () => {
			const people = personScope.createMap();
			people.set('bob', { firstName: 'Bob', lastName: 'Jones' });

			function App() {
				const [fullName] = people.use('bob', 'fullName');
				return <span data-testid="val">{fullName}</span>;
			}
			render(<App />);
			expect(screen.getByTestId('val').textContent).toBe('Bob Jones');
			act(() => people.get('bob')!.set('firstName', 'Robert'));
			expect(screen.getByTestId('val').textContent).toBe('Robert Jones');
		});

		it('use(key, field) does NOT re-render when a different field changes', () => {
			const people = personScope.createMap();
			people.set('bob', { firstName: 'Bob', lastName: 'Jones' });
			let renderCount = 0;

			function App() {
				const [firstName] = people.use('bob', 'firstName');
				renderCount++;
				return <span data-testid="val">{firstName as string}</span>;
			}
			render(<App />);
			expect(renderCount).toBe(1);
			// Changing a different field should NOT re-render
			act(() => people.get('bob')!.set('role', 'admin'));
			expect(renderCount).toBe(1);
			// Changing the subscribed field SHOULD re-render
			act(() => people.get('bob')!.set('firstName', 'Robert'));
			expect(renderCount).toBe(2);
		});

		it('useKeys() re-renders when collection changes', () => {
			const people = personScope.createMap();
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
});
