// Throughput benchmark for the scope hot paths. Run against the built dist:
//
//   pnpm bench                       # builds, then runs with --expose-gc
//   node --expose-gc bench/scope.mjs # run directly against an existing dist
//
// Reports the best (minimum) ns/op across several rounds for create / write /
// snapshot across a few scope shapes. Allocation-heavy ops (create) are
// dominated by GC jitter, so the *minimum* round — the one least interrupted by
// a collection — is the most stable estimator for comparing two builds. We also
// force a GC between rounds when run with --expose-gc to keep rounds
// independent. Numbers are only comparable on the same machine: run before,
// stash the change, run after.

import { valueScope, value } from '../dist/index.mjs';

const ROUNDS = 12;
const BUDGET_MS = 200;
const WARMUP_MS = 150;
const gc = globalThis.gc ?? (() => {});

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
	let bestRate = 0;
	for (let r = 0; r < ROUNDS; r++) {
		gc();
		const t0 = performance.now();
		const { ops } = run(fn, BUDGET_MS);
		const elapsed = performance.now() - t0;
		bestRate = Math.max(bestRate, ops / (elapsed / 1000));
	}
	const nsOp = 1e9 / bestRate;
	console.log(
		`${name.padEnd(34)} ${nsOp.toFixed(0).padStart(8)} ns/op  ` +
			`${Math.round(bestRate).toLocaleString().padStart(13)} ops/s`,
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
