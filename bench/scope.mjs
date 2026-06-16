// Throughput benchmark for the scope hot paths. Run against the built dist:
//
//   pnpm build && node bench/scope.mjs
//
// Reports ns/op and ops/sec for create / write / snapshot across a few scope
// shapes. Dependency-free: warmup, then a timed budget per case, median of
// several rounds to damp GC/JIT noise. Numbers are only comparable on the same
// machine — use it to judge a change (run before, stash, run after), not as an
// absolute.

import { valueScope, value } from '../dist/index.mjs';

const ROUNDS = 7;
const BUDGET_MS = 250;
const WARMUP_MS = 100;

/** Run `fn` for `ms`, return ops completed. `fn` returns a value we keep so V8
 * can't dead-code-eliminate the work. */
function run(fn, ms) {
	let ops = 0;
	let sink;
	const end = performance.now() + ms;
	do {
		sink = fn();
		ops++;
	} while (performance.now() < end);
	return { ops, sink };
}

function bench(name, fn) {
	run(fn, WARMUP_MS); // warm JIT
	const rates = [];
	for (let r = 0; r < ROUNDS; r++) {
		const t0 = performance.now();
		const { ops } = run(fn, BUDGET_MS);
		const elapsed = performance.now() - t0;
		rates.push(ops / (elapsed / 1000));
	}
	rates.sort((a, b) => a - b);
	const opsSec = rates[rates.length >> 1];
	const nsOp = 1e9 / opsSec;
	console.log(
		`${name.padEnd(34)} ${nsOp.toFixed(0).padStart(8)} ns/op  ` +
			`${Math.round(opsSec).toLocaleString().padStart(13)} ops/s`,
	);
}

// --- Scope shapes ---

const plain2 = valueScope({
	first: value('Alice'),
	last: value('Smith'),
});

const wide10 = valueScope(
	Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`f${i}`, value(i)])),
);

const derived = valueScope(
	{ first: value('Alice'), last: value('Smith') },
	{ full: ({ scope }) => `${scope.first.use()} ${scope.last.use()}` },
);

const derived5 = valueScope(
	{ n: value(1) },
	Object.fromEntries(
		Array.from({ length: 5 }, (_, i) => [
			`d${i}`,
			({ scope }) => scope.n.use() * (i + 1),
		]),
	),
);

// --- Cases ---

console.log(`node ${process.version}\n`);

bench('create plain (2 fields)', () => plain2.create());
bench('create wide (10 fields)', () => wide10.create());
bench('create derived (1 deriv)', () => derived.create());
bench('create derived (5 derivs)', () => derived5.create());

const inst = plain2.create();
let n = 0;
bench('write field', () => {
	inst.first.set(n++ & 1 ? 'a' : 'b');
	return inst;
});

bench('getSnapshot (after write)', () => {
	inst.last.set(n++ & 1 ? 'x' : 'y');
	return inst.$getSnapshot();
});

bench('getSnapshot (cached)', () => inst.$getSnapshot());
