import { describe, it, expect, vi } from 'vitest';
import { type } from 'arktype';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { value } from '../core/value.js';
import { valueScope } from '../core/value-scope.js';

import { valueSchema } from '../core/value-schema.js';
import { valueRef } from '../core/value-ref.js';

// ── Test schemas ───────────────────────────────────────────────────────

const Email = type('string.email');
const Password = type('string >= 8');
const View = type("'list' | 'grid'");
const Count = type('string.numeric.parse'); // In=string, Out=number

// ── Standalone usage ───────────────────────────────────────────────────

describe('valueSchema (standalone)', () => {
	it('creates a reactive value typed from the schema', () => {
		const email = valueSchema(Email, '');
		expect(email.get()).toBe('');
	});

	it('.set() stores whatever was set, regardless of validity', () => {
		const email = valueSchema(Email, '');
		email.set('not-an-email');
		expect(email.get()).toBe('not-an-email');
	});

	it('.getValidation() returns invalid state for bad input', () => {
		const email = valueSchema(Email, '');
		email.set('not-an-email');
		const validation = email.getValidation();
		expect(validation.isValid).toBe(false);
		expect(validation.value).toBe('not-an-email');
		expect(validation.issues.length).toBeGreaterThan(0);
	});

	it('.getValidation() returns valid state for good input', () => {
		const email = valueSchema(Email, '');
		email.set('alice@example.com');
		const validation = email.getValidation();
		expect(validation.isValid).toBe(true);
		expect(validation.value).toBe('alice@example.com');
		expect(validation.issues).toEqual([]);
	});

	it('validates the default on creation', () => {
		const email = valueSchema(Email, 'bad');
		const validation = email.getValidation();
		expect(validation.isValid).toBe(false);
		expect(validation.value).toBe('bad');
	});

	it('validates a good default as valid on creation', () => {
		const email = valueSchema(Email, 'alice@example.com');
		const validation = email.getValidation();
		expect(validation.isValid).toBe(true);
	});

	/**
	 * Bug: `runValidation` already catches async schemas explicitly, but
	 * a synchronous `validate()` that throws (some real-world validators
	 * raise on malformed input rather than returning issues) propagates
	 * out of `valueSchema.set()`. The value still gets written, but the
	 * validation state never updates — readers see the stale prior state
	 * with no signal that validation actually failed.
	 *
	 * Contract: a throwing schema validator does not propagate out of
	 * `.set()`. The validation state surfaces the failure as `isValid:
	 * false` with a synthetic issue describing the throw, and the next
	 * non-throwing write recovers.
	 */
	describe('throw containment for schema validators', () => {
		const throwingSchema: StandardSchemaV1<string, string> = {
			'~standard': {
				version: 1,
				vendor: 'test-throwing',
				validate: (input) => {
					if (input === 'bomb') throw new Error('kaboom in validator');
					return { value: input as string };
				},
			},
		};

		it('throw inside schema.validate does not propagate out of .set()', () => {
			const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const name = valueSchema(throwingSchema, 'alice');
			expect(() => name.set('bomb')).not.toThrow();
			expect(name.get()).toBe('bomb');
			expect(errSpy).toHaveBeenCalled();
			errSpy.mockRestore();
		});

		it('validation state surfaces the throw as invalid', () => {
			const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const name = valueSchema(throwingSchema, 'alice');
			name.set('bomb');
			const validation = name.getValidation();
			expect(validation.isValid).toBe(false);
			expect(validation.value).toBe('bomb');
			expect(validation.issues.length).toBeGreaterThan(0);
			errSpy.mockRestore();
		});

		it('throw on initial value surfaces as invalid, not a constructor throw', () => {
			const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			expect(() => valueSchema(throwingSchema, 'bomb')).not.toThrow();
			const name = valueSchema(throwingSchema, 'bomb');
			expect(name.getValidation().isValid).toBe(false);
			errSpy.mockRestore();
		});

		it('next non-throwing write recovers validation state', () => {
			const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const name = valueSchema(throwingSchema, 'alice');
			name.set('bomb');
			expect(name.getValidation().isValid).toBe(false);
			name.set('carol');
			expect(name.getValidation().isValid).toBe(true);
			expect(name.getValidation().value).toBe('carol');
			errSpy.mockRestore();
		});
	});
});

// ── Parsing morphs (In ≠ Out) ──────────────────────────────────────────

describe('valueSchema with parsing morphs', () => {
	it('.get() returns the input type', () => {
		const count = valueSchema(Count, '0');
		expect(count.get()).toBe('0');
		count.set('42');
		expect(count.get()).toBe('42');
	});

	it('valid result has parsed Out value', () => {
		const count = valueSchema(Count, '42');
		const validation = count.getValidation();
		expect(validation.isValid).toBe(true);
		// The parsed output should be a number
		expect(validation.value).toBe(42);
	});

	it('invalid result has raw In value', () => {
		const count = valueSchema(Count, 'not-a-number');
		const validation = count.getValidation();
		expect(validation.isValid).toBe(false);
		expect(validation.value).toBe('not-a-number');
		expect(validation.issues.length).toBeGreaterThan(0);
	});
});

// ── Literal union schemas ──────────────────────────────────────────────

describe('valueSchema with literal unions', () => {
	it('accepts valid literals', () => {
		const view = valueSchema(View, 'list');
		expect(view.get()).toBe('list');
		const validation = view.getValidation();
		expect(validation.isValid).toBe(true);
	});

	it('rejects invalid values with issues', () => {
		const view = valueSchema(View, 'list');
		view.set('spreadsheet' as any);
		expect(view.get()).toBe('spreadsheet');
		const validation = view.getValidation();
		expect(validation.isValid).toBe(false);
		expect(validation.issues.length).toBeGreaterThan(0);
	});
});

// ── Object schemas ─────────────────────────────────────────────────────

describe('valueSchema with object schemas', () => {
	const UserInput = type({
		name: '1 < string <= 100',
		email: 'string.email',
	});

	it('validates the whole object as a unit', () => {
		const user = valueSchema(UserInput, { name: '', email: '' });
		const validation = user.getValidation();
		expect(validation.isValid).toBe(false);
	});

	it('reports valid when all fields pass', () => {
		const user = valueSchema(UserInput, {
			name: 'Alice',
			email: 'alice@example.com',
		});
		const validation = user.getValidation();
		expect(validation.isValid).toBe(true);
	});
});

// ── In scope definitions ───────────────────────────────────────────────

describe('valueSchema in scopes', () => {
	it('works as a scope field', () => {
		const form = valueScope({
			email: valueSchema(Email, ''),
		});
		const instance = form.create();
		expect(instance.email.get()).toBe('');
		instance.email.set('alice@example.com');
		expect(instance.email.get()).toBe('alice@example.com');
	});

	it('.getValidation() on scope field', () => {
		const form = valueScope({
			email: valueSchema(Email, ''),
		});
		const instance = form.create();

		instance.email.set('bad');
		expect(instance.email.getValidation().isValid).toBe(false);

		instance.email.set('alice@example.com');
		expect(instance.email.getValidation().isValid).toBe(true);
	});

	it('accepts initial values via create()', () => {
		const form = valueScope({
			email: valueSchema(Email, ''),
		});
		const instance = form.create({ email: 'alice@example.com' });
		expect(instance.email.get()).toBe('alice@example.com');
		expect(instance.email.getValidation().isValid).toBe(true);
	});
});

// ── Pipes with valueSchema ─────────────────────────────────────────────

describe('valueSchema with pipes', () => {
	it('pipe runs before validation', () => {
		const email = valueSchema(Email, '').pipe((s: string) => s.toLowerCase());
		email.set('ALICE@EXAMPLE.COM');
		expect(email.get()).toBe('alice@example.com');
		expect(email.getValidation().isValid).toBe(true);
	});

	it('pipe that produces invalid input stores value and reports error', () => {
		const email = valueSchema(Email, 'ok@ok.com').pipe((s: string) =>
			s.replace('@', ''),
		);
		email.set('alice@example.com');
		// pipe strips @, so stored value is 'aliceexample.com'
		expect(email.get()).toBe('aliceexample.com');
		expect(email.getValidation().isValid).toBe(false);
	});
});

// ── compareUsing with valueSchema ──────────────────────────────────────

describe('valueSchema with compareUsing', () => {
	it('skips write and validate when compareUsing reports equal', () => {
		const view = valueSchema(View, 'list').compareUsing(
			(a: string, b: string) => a === b,
		);
		view.set('list'); // same as default
		// Value is unchanged, validation should still be from the initial set
		const validation = view.getValidation();
		expect(validation.isValid).toBe(true);
		expect(validation.value).toBe('list');
	});
});

// ── destroy semantics ──────────────────────────────────────────────────

describe('valueSchema destroy()', () => {
	it('stops all subscribers from firing', () => {
		const email = valueSchema(Email, '');
		const fn = vi.fn();
		email.subscribe(fn);
		email.destroy();
		email.set('alice@example.com');
		expect(fn).not.toHaveBeenCalled();
	});

	it('writes after destroy are silently dropped', () => {
		const email = valueSchema(Email, 'initial@example.com');
		email.destroy();
		email.set('after-destroy@example.com');
		// Reads still return the last value.
		expect(email.get()).toBe('initial@example.com');
	});

	it('destroy() is idempotent', () => {
		const email = valueSchema(Email, '');
		email.subscribe(() => {});
		expect(() => {
			email.destroy();
			email.destroy();
		}).not.toThrow();
	});
});

// ── $getIsValid() / $useIsValid() ──────────────────────────────────────

describe('$getIsValid()', () => {
	it('returns true when all schema fields are valid', () => {
		const form = valueScope({
			email: valueSchema(Email, 'alice@example.com'),
			password: valueSchema(Password, 'longpassword'),
		});
		const instance = form.create();
		expect(instance.$getIsValid()).toBe(true);
	});

	it('returns false when any schema field is invalid', () => {
		const form = valueScope({
			email: valueSchema(Email, ''),
			password: valueSchema(Password, 'longpassword'),
		});
		const instance = form.create();
		expect(instance.$getIsValid()).toBe(false);
	});

	it('throws when scope has no validation sources', () => {
		const scope = valueScope({
			name: value<string>('Bob'),
		});
		const instance = scope.create();
		// $getIsValid should throw a descriptive error, not just "not a function"
		expect(() => (instance as any).$getIsValid()).toThrow(
			/valueSchema|validate/i,
		);
	});

	it('includes validate hook issues', () => {
		const form = valueScope(
			{
				password: valueSchema(Password, 'longpassword'),
				confirm: valueSchema(Password, 'different'),
			},
			{
				validate: ({ scope }: { scope: any }) => {
					const issues: StandardSchemaV1.Issue[] = [];
					if (scope.password.use() !== scope.confirm.use()) {
						issues.push({
							message: 'Passwords must match',
							path: ['confirm'],
						});
					}
					return issues;
				},
			},
		);
		const instance = form.create();
		// Both schema fields are valid (>= 8 chars), but cross-field fails
		expect(instance.$getIsValid()).toBe(false);
	});

	it('returns true when validate hook returns empty issues', () => {
		const form = valueScope(
			{
				password: valueSchema(Password, 'longpassword'),
				confirm: valueSchema(Password, 'longpassword'),
			},
			{
				validate: ({ scope }: { scope: any }) => {
					const issues: StandardSchemaV1.Issue[] = [];
					if (scope.password.use() !== scope.confirm.use()) {
						issues.push({
							message: 'Passwords must match',
							path: ['confirm'],
						});
					}
					return issues;
				},
			},
		);
		const instance = form.create();
		expect(instance.$getIsValid()).toBe(true);
	});

	/**
	 * Bug: `ValidationState<In, Out>` is a discriminated union:
	 *   - `isValid: true`  ⇒ `value: Out`  (parsed)
	 *   - `isValid: false` ⇒ `value: In`   (raw input)
	 *
	 * When a validate-hook issue is routed to a schema field whose own
	 * schema validation passes, the field's `getValidation()` was wrapped
	 * to report `isValid: false` while still returning `baseValidation.value`
	 * — i.e. the parsed `Out`. For schemas where In and Out diverge (parsing
	 * morphs like `string.numeric.parse`), readers that branch on `isValid`
	 * and then read `value` get the wrong type at runtime.
	 */
	it('routed validate-hook issues preserve the In type in value', () => {
		const form = valueScope(
			{ count: valueSchema(Count, '0') }, // In=string, Out=number
			{
				validate: ({ scope }: { scope: any }) => {
					scope.count.use(); // track
					return [{ message: 'too small', path: ['count'] }];
				},
			},
		);
		const instance = form.create();
		const v = instance.count.getValidation();
		expect(v.isValid).toBe(false);
		// When isValid is false the discriminated union promises the raw In
		// (the string '0'), not the parsed Out (number 0).
		expect(v.value).toBe('0');
	});

	it('deep: false (default) ignores invalid nested scopes', () => {
		const address = valueScope({
			zip: valueSchema(type('5 <= string <= 5'), ''),
		});
		const person = valueScope({
			name: valueSchema(type('string > 1'), 'Alice'),
			address: valueRef(() => address.create()),
		});
		const instance = person.create();
		// Nested zip is '' (invalid), own fields valid — shallow passes
		expect(instance.$getIsValid()).toBe(true);
	});

	it('deep: true catches invalid field in a valueRef scope', () => {
		const address = valueScope({
			zip: valueSchema(type('5 <= string <= 5'), ''),
		});
		const person = valueScope({
			name: valueSchema(type('string > 1'), 'Alice'),
			address: valueRef(() => address.create()),
		});
		const instance = person.create();
		expect(instance.$getIsValid({ deep: true })).toBe(false);

		(instance.address as any).zip.set('12345');
		expect(instance.$getIsValid({ deep: true })).toBe(true);
	});

	it('deep: true walks through a shared valueRef scope instance', () => {
		const shared = valueScope({
			token: valueSchema(type('string > 0'), ''),
		}).create();
		const parent = valueScope({
			name: valueSchema(type('string > 0'), 'ok'),
			auth: valueRef(shared),
		});
		const instance = parent.create();
		expect(instance.$getIsValid({ deep: true })).toBe(false);
		shared.token.set('tok');
		expect(instance.$getIsValid({ deep: true })).toBe(true);
	});

	it('deep: true recurses through nested scope refs', () => {
		const leaf = valueScope({
			code: valueSchema(type('string > 0'), ''),
		});
		const middle = valueScope({
			label: valueSchema(type('string > 0'), 'm'),
			leaf: valueRef(() => leaf.create()),
		});
		const root = valueScope({
			title: valueSchema(type('string > 0'), 'r'),
			middle: valueRef(() => middle.create()),
		});
		const instance = root.create();
		expect(instance.$getIsValid({ deep: true })).toBe(false);
		((instance.middle as any).leaf as any).code.set('c');
		expect(instance.$getIsValid({ deep: true })).toBe(true);
	});

	it('deep: true walks ScopeMap entries', () => {
		const card = valueScope({
			title: valueSchema(type('string > 0'), ''),
		});
		const board = valueScope({
			name: valueSchema(type('string > 0'), 'Board'),
			cards: valueRef(() => card.createMap()),
		});
		const instance = board.create();
		// Empty map — deep is true (own fields valid, no entries)
		expect(instance.$getIsValid({ deep: true })).toBe(true);

		(instance.cards as any).set('c1', { title: '' });
		expect(instance.$getIsValid({ deep: true })).toBe(false);

		(instance.cards as any).get('c1').title.set('Buy milk');
		expect(instance.$getIsValid({ deep: true })).toBe(true);

		(instance.cards as any).set('c2', { title: '' });
		expect(instance.$getIsValid({ deep: true })).toBe(false);

		(instance.cards as any).delete('c2');
		expect(instance.$getIsValid({ deep: true })).toBe(true);
	});

	it('deep: true works when the parent has no own validation', () => {
		const child = valueScope({
			name: valueSchema(type('string > 0'), ''),
		});
		const parent = valueScope({
			child: valueRef(() => child.create()),
		});
		const instance = parent.create();
		// Parent has no schema/validate of its own, but child does — deep should work
		expect(instance.$getIsValid({ deep: true })).toBe(false);
		(instance.child as any).name.set('ok');
		expect(instance.$getIsValid({ deep: true })).toBe(true);
	});

	it('deep: true ignores refs that are not scope instances', () => {
		const plain = value<string>('anything');
		const parent = valueScope({
			name: valueSchema(type('string > 0'), 'ok'),
			tag: valueRef(plain),
		});
		const instance = parent.create();
		expect(instance.$getIsValid({ deep: true })).toBe(true);
	});

	it('deep: true tolerates cycles between scope instances', () => {
		const a = valueScope({
			label: valueSchema(type('string > 0'), 'a'),
		}).create();
		const b = valueScope({
			label: valueSchema(type('string > 0'), 'b'),
			a: valueRef(a),
		}).create();
		// Patch a to ref b (cycle)
		(a as any).other = b;
		// Should not infinite-loop
		expect(() => (a as any).$getIsValid({ deep: true })).not.toThrow();
	});

	it('deep: true with a child that has no validation sources treats it as valid', () => {
		const leaf = valueScope({
			note: value<string>('anything'),
		});
		const parent = valueScope({
			name: valueSchema(type('string > 0'), 'ok'),
			leaf: valueRef(() => leaf.create()),
		});
		const instance = parent.create();
		expect(instance.$getIsValid({ deep: true })).toBe(true);
	});
});

// ── $getValidation() ──────────────────────────────────────────────────

describe('$getValidation()', () => {
	it('returns isValid:true and empty issues when nothing is wrong', () => {
		const form = valueScope({
			email: valueSchema(Email, 'alice@example.com'),
			password: valueSchema(Password, 'longpassword'),
		});
		const instance = form.create();
		const result = (instance as any).$getValidation();
		expect(result.isValid).toBe(true);
		expect(result.issues).toEqual([]);
	});

	it('prefixes per-field schema issues with [fieldName]', () => {
		const form = valueScope({
			email: valueSchema(Email, 'not-an-email'),
			password: valueSchema(Password, 'longpassword'),
		});
		const instance = form.create();
		const result = (instance as any).$getValidation();
		expect(result.isValid).toBe(false);
		// Find the issue routed from the email field
		const emailIssues = result.issues.filter(
			(i: StandardSchemaV1.Issue) => i.path?.[0] === 'email',
		);
		expect(emailIssues.length).toBeGreaterThan(0);
		expect(emailIssues[0].path?.[0]).toBe('email');
	});

	it('passes validate hook issues through with author-supplied paths', () => {
		const form = valueScope(
			{
				password: valueSchema(Password, 'longpassword'),
				confirm: valueSchema(Password, 'different'),
			},
			{
				validate: ({ scope }: { scope: any }) => {
					const issues: StandardSchemaV1.Issue[] = [];
					if (scope.password.use() !== scope.confirm.use()) {
						issues.push({
							message: 'Passwords must match',
							path: ['confirm'],
						});
					}
					return issues;
				},
			},
		);
		const instance = form.create();
		const result = (instance as any).$getValidation();
		expect(result.isValid).toBe(false);
		const matchIssue = result.issues.find(
			(i: StandardSchemaV1.Issue) => i.message === 'Passwords must match',
		);
		expect(matchIssue).toBeDefined();
		expect(matchIssue.path).toEqual(['confirm']);
	});

	it('does not duplicate validate-routed issues in shallow mode', () => {
		// The validate hook routes 'Passwords must match' to confirm field.
		// FieldValueSchema.getValidation() merges that routed issue into the field's
		// own validation (value-scope.ts:1241-1264). $getValidation should still
		// emit each issue exactly once.
		const form = valueScope(
			{
				password: valueSchema(Password, 'longpassword'),
				confirm: valueSchema(Password, 'different'),
			},
			{
				validate: ({ scope }: { scope: any }) => {
					const issues: StandardSchemaV1.Issue[] = [];
					if (scope.password.use() !== scope.confirm.use()) {
						issues.push({
							message: 'Passwords must match',
							path: ['confirm'],
						});
					}
					return issues;
				},
			},
		);
		const instance = form.create();
		const result = (instance as any).$getValidation();
		const matches = result.issues.filter(
			(i: StandardSchemaV1.Issue) => i.message === 'Passwords must match',
		);
		expect(matches.length).toBe(1);
	});

	it('shallow ignores nested ref scope issues by default', () => {
		const address = valueScope({
			zip: valueSchema(type('5 <= string <= 5'), ''),
		});
		const person = valueScope({
			name: valueSchema(type('string > 1'), 'Alice'),
			address: valueRef(() => address.create()),
		});
		const instance = person.create();
		const result = (instance as any).$getValidation();
		expect(result.isValid).toBe(true);
		expect(result.issues).toEqual([]);
	});

	it('throws shallow with no validation sources', () => {
		const scope = valueScope({ name: value<string>('Bob') });
		const instance = scope.create();
		expect(() => (instance as any).$getValidation()).toThrow(
			/valueSchema|validate/i,
		);
	});

	it('deep: true prefixes nested valueRef scope issues with the ref field name', () => {
		const address = valueScope({
			zip: valueSchema(type('5 <= string <= 5'), ''),
		});
		const person = valueScope({
			name: valueSchema(type('string > 1'), 'Alice'),
			address: valueRef(() => address.create()),
		});
		const instance = person.create();
		const result = (instance as any).$getValidation({ deep: true });
		expect(result.isValid).toBe(false);
		const zipIssue = result.issues.find(
			(i: StandardSchemaV1.Issue) => i.path?.[0] === 'address',
		);
		expect(zipIssue).toBeDefined();
		expect(zipIssue.path).toEqual(['address', 'zip']);
	});

	it('deep: true prefixes ScopeMap entry issues with [mapField, entryKey, ...]', () => {
		const card = valueScope({
			title: valueSchema(type('string > 0'), ''),
		});
		const board = valueScope({
			name: valueSchema(type('string > 0'), 'Board'),
			cards: valueRef(() => card.createMap()),
		});
		const instance = board.create();
		(instance.cards as any).set('c1', { title: '' });

		const result = (instance as any).$getValidation({ deep: true });
		expect(result.isValid).toBe(false);
		const cardIssue = result.issues.find(
			(i: StandardSchemaV1.Issue) => i.path?.[0] === 'cards',
		);
		expect(cardIssue).toBeDefined();
		expect(cardIssue.path).toEqual(['cards', 'c1', 'title']);
	});

	it('deep: true prefixes nested validate hook issues with the ref field name', () => {
		const passwordPair = valueScope(
			{
				password: valueSchema(Password, 'longpassword'),
				confirm: valueSchema(Password, 'different'),
			},
			{
				validate: ({ scope }: { scope: any }) => {
					const issues: StandardSchemaV1.Issue[] = [];
					if (scope.password.use() !== scope.confirm.use()) {
						issues.push({
							message: 'Passwords must match',
							path: ['confirm'],
						});
					}
					return issues;
				},
			},
		);
		const wizard = valueScope({
			account: valueRef(() => passwordPair.create()),
		});
		const instance = wizard.create();
		const result = (instance as any).$getValidation({ deep: true });
		expect(result.isValid).toBe(false);
		const matchIssue = result.issues.find(
			(i: StandardSchemaV1.Issue) => i.message === 'Passwords must match',
		);
		expect(matchIssue).toBeDefined();
		expect(matchIssue.path).toEqual(['account', 'confirm']);
	});

	it('deep: true recurses through multiple levels with stacked prefixes', () => {
		const leaf = valueScope({
			code: valueSchema(type('string > 0'), ''),
		});
		const middle = valueScope({
			leaf: valueRef(() => leaf.create()),
		});
		const root = valueScope({
			middle: valueRef(() => middle.create()),
		});
		const instance = root.create();
		const result = (instance as any).$getValidation({ deep: true });
		expect(result.isValid).toBe(false);
		const issue = result.issues[0];
		expect(issue.path).toEqual(['middle', 'leaf', 'code']);
	});

	it('deep: true returns valid with no issues when everything is fine', () => {
		const address = valueScope({
			zip: valueSchema(type('5 <= string <= 5'), '12345'),
		});
		const person = valueScope({
			name: valueSchema(type('string > 1'), 'Alice'),
			address: valueRef(() => address.create()),
		});
		const instance = person.create();
		const result = (instance as any).$getValidation({ deep: true });
		expect(result.isValid).toBe(true);
		expect(result.issues).toEqual([]);
	});

	it('deep: true tolerates cycles between scope instances', () => {
		const a = valueScope({
			label: valueSchema(type('string > 0'), 'a'),
		}).create();
		const b = valueScope({
			label: valueSchema(type('string > 0'), 'b'),
			a: valueRef(a),
		}).create();
		(a as any).other = b;
		expect(() => (a as any).$getValidation({ deep: true })).not.toThrow();
	});

	it('deep: true works when the parent has no own validation', () => {
		const child = valueScope({
			name: valueSchema(type('string > 0'), ''),
		});
		const parent = valueScope({
			child: valueRef(() => child.create()),
		});
		const instance = parent.create();
		const result = (instance as any).$getValidation({ deep: true });
		expect(result.isValid).toBe(false);
		const issue = result.issues[0];
		expect(issue.path).toEqual(['child', 'name']);
	});
});

// ── $getValidation edge cases ─────────────────────────────────────────

describe('$getValidation() edge cases', () => {
	it('preserves the schema-internal path under the field name (object schema)', () => {
		// Address schema's issues come back with path like ['zip']. When stored
		// under the 'address' field, $getValidation should layer them as
		// ['address', 'zip'] — proving the prefix is [fieldName, ...issue.path],
		// not just [fieldName].
		const Address = type({ street: 'string > 0', zip: '5 <= string <= 5' });
		const form = valueScope({
			address: valueSchema(Address, { street: '123 Main', zip: 'bad' }),
		});
		const instance = form.create();
		const result = (instance as any).$getValidation();
		expect(result.isValid).toBe(false);
		const zipIssue = result.issues.find(
			(i: StandardSchemaV1.Issue) =>
				i.path && i.path.length >= 2 && i.path[1] === 'zip',
		);
		expect(zipIssue).toBeDefined();
		expect(zipIssue.path[0]).toBe('address');
	});

	it('emits every issue from a multi-issue field', () => {
		// Custom Standard Schema validator returning two issues.
		const MultiBad: StandardSchemaV1<string, string> = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: () => ({
					issues: [{ message: 'too short' }, { message: 'must contain digit' }],
				}),
			},
		};
		const form = valueScope({
			pwd: valueSchema(MultiBad, ''),
		});
		const instance = form.create();
		const result = (instance as any).$getValidation();
		expect(result.isValid).toBe(false);
		const pwdIssues = result.issues.filter(
			(i: StandardSchemaV1.Issue) => i.path?.[0] === 'pwd',
		);
		expect(pwdIssues.length).toBe(2);
		expect(pwdIssues.map((i: StandardSchemaV1.Issue) => i.message)).toEqual([
			'too short',
			'must contain digit',
		]);
	});

	it('preserves PathSegment object form in issue paths', () => {
		// Standard Schema allows path segments to be { key: PropertyKey } objects.
		// Our prefixing should preserve those without unwrapping.
		const segment = { key: 'inner' as PropertyKey };
		const Segmented: StandardSchemaV1<string, string> = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: () => ({
					issues: [{ message: 'bad inner', path: [segment] }],
				}),
			},
		};
		const form = valueScope({
			outer: valueSchema(Segmented, ''),
		});
		const instance = form.create();
		const result = (instance as any).$getValidation();
		expect(result.isValid).toBe(false);
		const issue = result.issues[0];
		expect(issue.path).toEqual(['outer', segment]);
		// The PathSegment is the same reference, not stringified.
		expect(issue.path[1]).toBe(segment);
	});

	it('aggregates own + nested ref + ScopeMap issues in one deep call', () => {
		const card = valueScope({
			title: valueSchema(type('string > 0'), ''),
		});
		const address = valueScope({
			zip: valueSchema(type('5 <= string <= 5'), ''),
		});
		const board = valueScope({
			name: valueSchema(type('string > 0'), ''),
			address: valueRef(() => address.create()),
			cards: valueRef(() => card.createMap()),
		});
		const instance = board.create();
		(instance.cards as any).set('c1', { title: '' });

		const result = (instance as any).$getValidation({ deep: true });
		expect(result.isValid).toBe(false);

		const paths = result.issues
			.map((i: StandardSchemaV1.Issue) => i.path?.join('.'))
			.toSorted();
		expect(paths).toEqual(['address.zip', 'cards.c1.title', 'name']);
	});

	it('deep: true ignores refs that are not scope instances', () => {
		const plain = value<string>('anything');
		const parent = valueScope({
			name: valueSchema(type('string > 0'), 'ok'),
			tag: valueRef(plain),
		});
		const instance = parent.create();
		const result = (instance as any).$getValidation({ deep: true });
		expect(result.isValid).toBe(true);
		expect(result.issues).toEqual([]);
	});

	it('deep: true returns valid for an empty ScopeMap', () => {
		const card = valueScope({
			title: valueSchema(type('string > 0'), ''),
		});
		const board = valueScope({
			name: valueSchema(type('string > 0'), 'Board'),
			cards: valueRef(() => card.createMap()),
		});
		const instance = board.create();
		const result = (instance as any).$getValidation({ deep: true });
		expect(result.isValid).toBe(true);
		expect(result.issues).toEqual([]);
	});

	it('deep: true treats a child without validation sources as valid', () => {
		const leaf = valueScope({
			note: value<string>('anything'),
		});
		const parent = valueScope({
			name: valueSchema(type('string > 0'), 'ok'),
			leaf: valueRef(() => leaf.create()),
		});
		const instance = parent.create();
		const result = (instance as any).$getValidation({ deep: true });
		expect(result.isValid).toBe(true);
		expect(result.issues).toEqual([]);
	});

	it('deep: true walks through a shared valueRef scope instance', () => {
		const shared = valueScope({
			token: valueSchema(type('string > 0'), ''),
		}).create();
		const parent = valueScope({
			name: valueSchema(type('string > 0'), 'ok'),
			auth: valueRef(shared),
		});
		const instance = parent.create();
		const result = (instance as any).$getValidation({ deep: true });
		expect(result.isValid).toBe(false);
		const issue = result.issues[0];
		expect(issue.path).toEqual(['auth', 'token']);
	});
});

// ── validate config option ─────────────────────────────────────────────

describe('validate scope config', () => {
	it('is a reactive derivation that returns Issue[]', () => {
		let callCount = 0;
		const form = valueScope(
			{
				password: valueSchema(Password, 'longpassword'),
				confirm: valueSchema(Password, 'longpassword'),
			},
			{
				validate: ({ scope }: { scope: any }) => {
					callCount++;
					const issues: StandardSchemaV1.Issue[] = [];
					if (scope.password.use() !== scope.confirm.use()) {
						issues.push({
							message: 'Passwords must match',
							path: ['confirm'],
						});
					}
					return issues;
				},
			},
		);
		const instance = form.create();
		const initialCount = callCount;

		// Changing a tracked dependency should re-evaluate
		instance.confirm.set('differentpass');
		// callCount should increase (re-evaluation happened)
		expect(callCount).toBeGreaterThan(initialCount);
	});

	it('routes issues to fields via path', () => {
		const form = valueScope(
			{
				password: valueSchema(Password, 'longpassword'),
				confirm: valueSchema(Password, 'longpassword'),
			},
			{
				validate: ({ scope }: { scope: any }) => {
					const issues: StandardSchemaV1.Issue[] = [];
					if (scope.password.use() !== scope.confirm.use()) {
						issues.push({
							message: 'Passwords must match',
							path: ['confirm'],
						});
					}
					return issues;
				},
			},
		);
		const instance = form.create();
		instance.confirm.set('different1');

		// The cross-field issue should appear in confirm's validation
		const validation = instance.confirm.getValidation();
		expect(validation.isValid).toBe(false);
		const messages = validation.issues.map(
			(issue: StandardSchemaV1.Issue) => issue.message,
		);
		expect(messages).toContain('Passwords must match');
	});

	it('issues without matching path are scope-level only', () => {
		const form = valueScope(
			{
				email: valueSchema(Email, 'alice@example.com'),
			},
			{
				validate: () => {
					return [{ message: 'Global error' }];
				},
			},
		);
		const instance = form.create();

		// email field should not see the scope-level issue
		const emailValidation = instance.email.getValidation();
		expect(emailValidation.isValid).toBe(true);

		// But $getIsValid() should be false
		expect(instance.$getIsValid()).toBe(false);
	});

	it('scope with only validate (no valueSchema fields) is valid', () => {
		const form = valueScope(
			{
				start: value<string>('2024-01-01'),
				end: value<string>('2024-12-31'),
			},
			{
				validate: ({ scope }: { scope: any }) => {
					const issues: StandardSchemaV1.Issue[] = [];
					if (scope.start.use() > scope.end.use()) {
						issues.push({ message: 'Start must be before end' });
					}
					return issues;
				},
			},
		);
		const instance = form.create();
		expect(instance.$getIsValid()).toBe(true);
	});

	it('composes via extend (both validate hooks run)', () => {
		const base = valueScope(
			{
				email: valueSchema(Email, 'alice@example.com'),
			},
			{
				validate: () => {
					return [{ message: 'base issue' }];
				},
			},
		);

		const extended = base.extend(
			{
				password: valueSchema(Password, 'longpassword'),
			},
			{
				validate: () => {
					return [{ message: 'extension issue' }];
				},
			},
		);

		const instance = extended.create();
		// Both validate hooks produce issues, so not valid
		expect(instance.$getIsValid()).toBe(false);
	});

	/**
	 * Bug: a `validate` hook that throws used to propagate the error out
	 * of the source field's `.set()`, because the hook runs inside a
	 * Preact `computed` synced via an `effect`. Worse, after the throw
	 * `validateIssuesSignal` was never updated, so `$getIsValid()`
	 * silently kept returning `true` — a broken validator looked valid.
	 *
	 * Contract: a throwing validate hook does not propagate out of
	 * `.set()`. The scope reports invalid (with a synthetic
	 * "validate threw" issue), and the next non-throwing run recovers.
	 */
	describe('throw containment in validate hook', () => {
		it('throw inside validate does not propagate out of source .set()', () => {
			const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const form = valueScope(
				{
					age: value<number>(0),
				},
				{
					validate: ({ scope }: { scope: any }) => {
						if (scope.age.use() < 0) throw new Error('negative age');
						return [];
					},
				},
			);
			const instance = form.create({ age: 30 });
			expect(() => instance.age.set(-1)).not.toThrow();
			expect(instance.age.get()).toBe(-1);
			expect(errSpy).toHaveBeenCalled();
			errSpy.mockRestore();
		});

		it('scope reports invalid when validate throws', () => {
			const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const form = valueScope(
				{
					age: value<number>(0),
				},
				{
					validate: ({ scope }: { scope: any }) => {
						if (scope.age.use() < 0) throw new Error('negative age');
						return [];
					},
				},
			);
			const instance = form.create({ age: 30 });
			expect(instance.$getIsValid()).toBe(true);
			instance.age.set(-1);
			expect(instance.$getIsValid()).toBe(false);
			errSpy.mockRestore();
		});

		it('next non-throwing run recovers validity', () => {
			const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const form = valueScope(
				{
					age: value<number>(0),
				},
				{
					validate: ({ scope }: { scope: any }) => {
						if (scope.age.use() < 0) throw new Error('negative age');
						return [];
					},
				},
			);
			const instance = form.create({ age: 30 });
			instance.age.set(-1);
			expect(instance.$getIsValid()).toBe(false);
			instance.age.set(25);
			expect(instance.$getIsValid()).toBe(true);
			errSpy.mockRestore();
		});
	});
});

// ── ValidationState discriminated union ────────────────────────────────

describe('ValidationState discriminated union', () => {
	it('valid state has isValid: true and issues: []', () => {
		const email = valueSchema(Email, 'alice@example.com');
		const validation = email.getValidation();
		expect(validation.isValid).toBe(true);
		expect(validation.issues).toEqual([]);
		expect(validation.value).toBe('alice@example.com');
	});

	it('invalid state has isValid: false and non-empty issues', () => {
		const email = valueSchema(Email, 'bad');
		const validation = email.getValidation();
		expect(validation.isValid).toBe(false);
		expect(validation.issues.length).toBeGreaterThan(0);
		expect(validation.value).toBe('bad');
	});

	it('issues are plain arrays (detached from library subclasses)', () => {
		const email = valueSchema(Email, 'bad');
		const validation = email.getValidation();
		// Should be a plain Array, not ArkErrors or any subclass
		expect(Object.getPrototypeOf(validation.issues)).toBe(Array.prototype);
	});
});

// ── Change tracking ────────────────────────────────────────────────────

describe('valueSchema change tracking', () => {
	it('.set() fires onChange regardless of validity', async () => {
		const onChange = vi.fn();
		const form = valueScope(
			{
				email: valueSchema(Email, ''),
			},
			{ onChange },
		);
		const instance = form.create();

		instance.email.set('bad-email');
		await Promise.resolve();
		expect(onChange).toHaveBeenCalledOnce();
	});

	it('.subscribe() fires on value change', () => {
		const email = valueSchema(Email, '');
		const subscriber = vi.fn();
		email.subscribe(subscriber);

		email.set('alice@example.com');
		expect(subscriber).toHaveBeenCalledOnce();
	});

	/**
	 * Bug: a throwing subscriber used to propagate out of `.set()`.
	 * Contract: throw is contained, siblings still fire, the write lands,
	 * subsequent writes work.
	 */
	it('a throwing subscriber does not poison .set()', () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const email = valueSchema(Email, '');
		const after = vi.fn();
		email.subscribe(() => {
			throw new Error('boom');
		});
		email.subscribe(after);
		expect(() => email.set('alice@example.com')).not.toThrow();
		expect(email.get()).toBe('alice@example.com');
		expect(after).toHaveBeenCalledOnce();
		errSpy.mockRestore();
	});
});
