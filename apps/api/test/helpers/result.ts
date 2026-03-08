export function ok<T>(value: T) {
  return {
    isOk: () => true,
    isErr: () => false,
    value,
  };
}

export function err(message: string) {
  return {
    isOk: () => false,
    isErr: () => true,
    error: { message },
  };
}
