type Constructor<Token = unknown> = new (...args: never[]) => Token;

const injectableRegistry = new Set<Constructor>();

export function Injectable() {
  return <Token extends Constructor>(token: Token) => {
    injectableRegistry.add(token);
  };
}

export class Container {
  private readonly instances = new Map<Constructor, unknown>();
  private readonly factories = new Map<Constructor, (container: Container) => unknown>();

  registerValue<T>(token: Constructor<T>, value: T): void {
    this.instances.set(token, value);
  }

  registerFactory<Token>(token: Constructor<Token>, factory: (container: Container) => Token): void {
    this.factories.set(token, factory);
  }

  resolve<Token>(token: Constructor<Token>): Token {
    if (this.instances.has(token)) {
      return this.instances.get(token) as Token;
    }

    const factory = this.factories.get(token);
    if (factory) {
      const instance = factory(this) as Token;
      this.instances.set(token, instance);
      return instance;
    }

    if (!injectableRegistry.has(token)) {
      throw new Error(`${token.name} is not registered. Add @Injectable() or a factory.`);
    }

    const instance = new token();
    this.instances.set(token, instance);
    return instance;
  }
}
