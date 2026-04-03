type RandomValueTarget =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | BigInt64Array
  | BigUint64Array;

type CryptoLike = {
  subtle?: SubtleCrypto;
  getRandomValues?: <T extends RandomValueTarget>(array: T) => T;
};

type WxLike = {
  getRandomValues?: <T extends RandomValueTarget>(array: T) => T | void;
};

const runtime = globalThis as {
  crypto?: CryptoLike;
  wx?: WxLike;
};

export const subtle = runtime.crypto?.subtle;

const fillWithMathRandom = <T extends RandomValueTarget>(array: T): T => {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return array;
};

const resolveRandomGenerator = () => {
  if (runtime.crypto?.getRandomValues) {
    return <T extends RandomValueTarget>(array: T): T => runtime.crypto!.getRandomValues!(array);
  }
  if (runtime.wx?.getRandomValues) {
    return <T extends RandomValueTarget>(array: T): T => {
      runtime.wx!.getRandomValues!(array);
      return array;
    };
  }
  return fillWithMathRandom;
};

const randomGenerator = resolveRandomGenerator();

export const getRandomValues = <T extends RandomValueTarget>(array: T): T => {
  return randomGenerator(array);
};
