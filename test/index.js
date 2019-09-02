// Mock storage
window = {
  localStorage: {
    store: {},
    getItem(key) {
      return this.store[key] || null;
    },
    setItem(key, value) {
      this.store[key] = value;
    },
    clear() {
      this.store = {};
    }
  }
};

const assert = require('assert');
const { readable, writable, derived, get } = require('../index');

// const STORAGE_KEY = 'test.storage.key';

beforeEach(() => {
  window.localStorage.clear();
});

describe('store', () => {
  describe('writable', () => {
    it('creates a writable store', () => {
      const count = writable('count', 0);
      const values = [];

      const unsubscribe = count.subscribe(value => {
        values.push(value);
      });

      count.set(1);
      count.update(n => n + 1);

      unsubscribe();

      count.set(3);
      count.update(n => n + 1);

      assert.deepEqual(values, [0, 1, 2]);
    });

    it('calls provided subscribe handler', () => {
      let called = 0;

      const store = writable('store', 0, () => {
        called += 1;
        return () => called -= 1;
      });

      const unsubscribe1 = store.subscribe(() => {
      });
      assert.equal(called, 1);

      const unsubscribe2 = store.subscribe(() => {
      });
      assert.equal(called, 1);

      unsubscribe1();
      assert.equal(called, 1);

      unsubscribe2();
      assert.equal(called, 0);
    });

    it('does not assume immutable data', () => {
      const obj = {};
      let called = 0;

      const store = writable('store', obj);

      store.subscribe(() => {
        called += 1;
      });

      store.set(obj);
      assert.equal(called, 2);

      store.update(obj => obj);
      assert.equal(called, 3);
    });

    it('only calls subscriber once initially, including on resubscriptions', () => {
      let num = 0;
      const store = writable('store', num, set => set(num += 1));

      let count1 = 0;
      let count2 = 0;

      store.subscribe(() => count1 += 1)();
      assert.equal(count1, 1);

      const unsubscribe = store.subscribe(() => count2 += 1);
      assert.equal(count2, 1);

      unsubscribe();
    });

    it('initial value should be stored', () => {
      const initial_value = 10;
      writable('store', initial_value);

      const stored_value = window.localStorage.getItem('store');

      assert.strictEqual(initial_value, stored_value);
    })
  });

  describe('readable', () => {
    it('creates a readable store', () => {
      let running;
      let tick;

      const store = readable('store', undefined, set => {
        tick = set;
        running = true;

        set(0);

        return () => {
          tick = () => {
          };
          running = false;
        };
      });

      assert.ok(!running);

      const values = [];

      const unsubscribe = store.subscribe(value => {
        values.push(value);
      });

      assert.ok(running);
      tick(1);
      tick(2);

      unsubscribe();

      assert.ok(!running);
      tick(3);
      tick(4);

      assert.deepEqual(values, [0, 1, 2]);
    });
  });

  describe('derived', () => {
    it('maps a single store', () => {
      const a = writable('a', 1);
      const b = derived('b', a, n => n * 2);

      const values = [];

      const unsubscribe = b.subscribe(value => {
        values.push(value);
      });

      a.set(2);
      assert.deepEqual(values, [2, 4]);

      unsubscribe();

      a.set(3);
      assert.deepEqual(values, [2, 4]);
    });

    it('maps multiple stores', () => {
      const a = writable('a', 2);
      const b = writable('b', 3);
      const c = derived('c', ([a, b]), ([a, b]) => a * b);

      const values = [];

      const unsubscribe = c.subscribe(value => {
        values.push(value);
      });

      a.set(4);
      b.set(5);
      assert.deepEqual(values, [6, 12, 20]);

      unsubscribe();

      a.set(6);
      assert.deepEqual(values, [6, 12, 20]);
    });

    it('passes optional set function', () => {
      const number = writable('number', 1);
      const evens = derived('evens', number, (n, set) => {
        if (n % 2 === 0) set(n);
      }, 0);

      const values = [];

      const unsubscribe = evens.subscribe(value => {
        values.push(value);
      });

      number.set(2);
      number.set(3);
      number.set(4);
      number.set(5);
      assert.deepEqual(values, [0, 2, 4]);

      unsubscribe();

      number.set(6);
      number.set(7);
      number.set(8);
      assert.deepEqual(values, [0, 2, 4]);
    });

    it('prevents glitches', () => {
      const lastname = writable('lastname', 'Jekyll');
      const firstname = derived('firstname', lastname, n => n === 'Jekyll' ? 'Henry' : 'Edward');

      const fullname = derived('fullname', [firstname, lastname], names => names.join(' '));

      const values = [];

      const unsubscribe = fullname.subscribe(value => {
        values.push(value);
      });

      lastname.set('Hyde');

      assert.deepEqual(values, [
        'Henry Jekyll',
        'Edward Hyde'
      ]);

      unsubscribe();
    });

    it('prevents diamond dependency problem', () => {
      const count = writable('count', 0);
      const values = [];

      const a = derived('a', count, $count => {
        return 'a' + $count;
      });

      const b = derived('b', count, $count => {
        return 'b' + $count;
      });

      const combined = derived('combined', [a, b], ([a, b]) => {
        return a + b;
      });

      const unsubscribe = combined.subscribe(v => {
        values.push(v);
      });

      assert.deepEqual(values, ['a0b0']);

      count.set(1);
      assert.deepEqual(values, ['a0b0', 'a1b1']);

      unsubscribe();
    });

    it('derived dependency does not update and shared ancestor updates', () => {
      const root = writable('root', { a: 0, b: 0 });
      const values = [];

      const a = derived('a', root, $root => {
        return 'a' + $root.a;
      });

      const b = derived('b', [a, root], ([$a, $root]) => {
        return 'b' + $root.b + $a;
      });

      const unsubscribe = b.subscribe(v => {
        values.push(v);
      });

      assert.deepEqual(values, ['b0a0']);

      root.set({ a: 0, b: 1 });
      assert.deepEqual(values, ['b0a0', 'b1a0']);

      unsubscribe();
    });

    it('is updated with safe_not_equal logic', () => {
      const arr = [0];

      const number = writable('number', 1);
      const numbers = derived('numbers', number, $number => {
        arr[0] = $number;
        return arr;
      });

      const concatenated = [];

      const unsubscribe = numbers.subscribe(value => {
        concatenated.push(...value);
      });

      number.set(2);
      number.set(3);

      assert.deepEqual(concatenated, [1, 2, 3]);

      unsubscribe();
    });

    it('calls a cleanup function', () => {
      const num = writable('num', 1);

      const values = [];
      const cleaned_up = [];

      const d = derived('d', num, ($num, set) => {
        set($num * 2);

        return function cleanup() {
          cleaned_up.push($num);
        };
      });

      num.set(2);

      const unsubscribe = d.subscribe(value => {
        values.push(value);
      });

      num.set(3);
      num.set(4);

      assert.deepEqual(values, [4, 6, 8]);
      assert.deepEqual(cleaned_up, [2, 3]);

      unsubscribe();

      assert.deepEqual(cleaned_up, [2, 3, 4]);
    });

    it('discards non-function return values', () => {
      const num = writable('num', 1);

      const values = [];

      const d = derived('d', num, ($num, set) => {
        set($num * 2);
        return {};
      });

      num.set(2);

      const unsubscribe = d.subscribe(value => {
        values.push(value);
      });

      num.set(3);
      num.set(4);

      assert.deepEqual(values, [4, 6, 8]);

      unsubscribe();
    });

    it('allows derived with different types', () => {
      const a = writable('a', 'one');
      const b = writable('b', 1);
      const c = derived('c', [a, b], ([a, b]) => `${a} ${b}`);

      assert.deepEqual(get(c), 'one 1');

      a.set('two');
      b.set(2);
      assert.deepEqual(get(c), 'two 2');
    });
  });

  describe('get', () => {
    it('gets the current value of a store', () => {
      const store = readable('store', 42, () => {
      });
      assert.equal(get(store), 42);
    });

    it('works with RxJS-style observables', () => {
      const observable = {
        subscribe(fn) {
          fn(42);
          return {
            unsubscribe: () => {
            }
          };
        }
      };

      assert.equal(get(observable), 42);
    });
  });
});
