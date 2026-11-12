/** A bounded cache for immutable input references; never retains old datasets. */
export function memoizeLast(compute) {
  let inputs, value;
  return (...next) => {
    if (!inputs || next.length !== inputs.length || next.some((input, i) => !Object.is(input, inputs[i]))) {
      value = compute(...next);
      inputs = next;
    }
    return value;
  };
}
