# TypeScript Advanced Patterns untuk Frontend

## Utility Types yang Sering Dipakai

```typescript
// Partial vs Required vs Readonly
type UpdateUserInput = Partial<User>; // Semua field optional
type RequiredConfig = Required<Config>; // Semua field required
type ImmutableState = Readonly<AppState>; // Tidak bisa diubah

// Pick dan Omit
type UserPreview = Pick<User, 'id' | 'name' | 'avatar'>;
type UserWithoutPassword = Omit<User, 'password' | 'salt'>;

// Record untuk object types
type FeatureFlags = Record<string, boolean>;
type RouteConfig = Record<string, { component: ComponentType; auth: boolean }>;

// Extract dan Exclude untuk union manipulation
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
type ReadMethod = Extract<HttpMethod, 'GET'>; // 'GET'
type MutationMethod = Exclude<HttpMethod, 'GET'>; // 'POST' | 'PUT' | 'DELETE' | 'PATCH'

// ReturnType dan Parameters
type ApiResponse = ReturnType<typeof fetchUser>;
type FetchParams = Parameters<typeof fetchUser>[0];
```

## Discriminated Unions untuk State yang Kompleks

```typescript
// Async state — paling sering dipakai
type AsyncState<T, E = Error> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: E };

// Type narrowing dengan discriminant
function renderState<T>(state: AsyncState<T>) {
  switch (state.status) {
    case 'idle':
      return null;
    case 'loading':
      return <Spinner />;
    case 'success':
      // TypeScript tahu state.data ada di sini
      return <DataDisplay data={state.data} />;
    case 'error':
      // TypeScript tahu state.error ada di sini
      return <ErrorMessage error={state.error} />;
  }
}

// Form state
type FormField<T> =
  | { isDirty: false; value: T }
  | { isDirty: true; value: T; initialValue: T };

// Payment flow
type PaymentState =
  | { step: 'select-method' }
  | { step: 'enter-details'; method: PaymentMethod }
  | { step: 'confirm'; method: PaymentMethod; amount: number }
  | { step: 'processing'; orderId: string }
  | { step: 'success'; orderId: string; receipt: Receipt }
  | { step: 'failed'; error: PaymentError; canRetry: boolean };
```

## Branded Types

```typescript
// Cegah kesalahan passing ID yang salah tipe
declare const __brand: unique symbol;
type Brand<T, B> = T & { [__brand]: B };

type UserId = Brand<string, 'UserId'>;
type ProductId = Brand<string, 'ProductId'>;
type OrderId = Brand<string, 'OrderId'>;

// Helper functions
const toUserId = (id: string): UserId => id as UserId;
const toProductId = (id: string): ProductId => id as ProductId;

// Sekarang ini akan error di compile time:
function getUser(id: UserId) { /* ... */ }
const productId = toProductId('123');
getUser(productId); // ❌ Error: Type 'ProductId' is not assignable to type 'UserId'
```

## Generic Constraints yang Berguna

```typescript
// Keyof untuk type-safe property access
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

const user = { name: 'John', age: 30 };
getProperty(user, 'name'); // ✅ string
getProperty(user, 'xyz');  // ❌ Error

// Conditional types
type IsArray<T> = T extends any[] ? true : false;
type Flatten<T> = T extends Array<infer Item> ? Item : T;

type Names = Flatten<string[]>; // string
type Age = Flatten<number>;     // number

// Template literal types
type EventName<T extends string> = `on${Capitalize<T>}`;
type ClickHandler = EventName<'click'>; // 'onClick'

// Mapped types dengan modifiers
type Mutable<T> = {
  -readonly [K in keyof T]: T[K]; // Remove readonly
};

type AllOptional<T> = {
  [K in keyof T]?: T[K]; // Make all optional
};
```

## Infer untuk Type Extraction

```typescript
// Extract return type dari async function
type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

type ApiData = UnwrapPromise<ReturnType<typeof fetchUser>>; // User

// Extract component props
type ComponentProps<T> = T extends ComponentType<infer P> ? P : never;
type ButtonProps = ComponentProps<typeof Button>;

// Extract array element type
type ArrayElement<T extends readonly unknown[]> =
  T extends readonly (infer E)[] ? E : never;

const colors = ['red', 'green', 'blue'] as const;
type Color = ArrayElement<typeof colors>; // 'red' | 'green' | 'blue'
```

## Strict Mode Best Practices

```json
// tsconfig.json — aktifkan semua strict checks
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,  // array[i] returns T | undefined
    "exactOptionalPropertyTypes": true, // undefined != missing property
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

```typescript
// noUncheckedIndexedAccess memaksa kamu handle undefined
const items = ['a', 'b', 'c'];
const first = items[0]; // string | undefined (bukan string!)

if (first) {
  console.log(first.toUpperCase()); // ✅ Safe
}

// Atau gunakan optional chaining
console.log(items[0]?.toUpperCase()); // ✅ 'A' | undefined
```

## Type Guards yang Proper

```typescript
// Custom type guard
function isUser(value: unknown): value is User {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    typeof (value as any).id === 'string' &&
    typeof (value as any).name === 'string'
  );
}

// Assertion function (throws jika tidak valid)
function assertIsUser(value: unknown): asserts value is User {
  if (!isUser(value)) {
    throw new Error(`Expected User, got: ${JSON.stringify(value)}`);
  }
}

// Usage
const data = await fetchUser(id);
assertIsUser(data); // Throws jika invalid, setelah ini TypeScript tahu data: User
console.log(data.name); // ✅ TypeScript happy
```
