import { 
  DependencyInjector, UndoChanges, Token,
  Provider, TypeProvider 
} from './injector.interfaces';


/**
 * Utility function used to easily create 1..n injectors; each with thier
 * own singletons and provider registry.
 * 
 * NOTE: If only a class is registered (instead of a Provider), convert to it 
 * for normalized usages
 */
export function makeInjector(registry: (Provider | TypeProvider)[]): DependencyInjector {
  const normalized = registry.map(it => {
    const isProvider = !!(it as Provider).provide;
    return isProvider ? it : makeClassProvider(it);
  }) as Provider[];

  return new Injector(normalized);
}

/**
 * Injector class that manages a registry of Providers and a registry
 * of singleton instances [singletons for the instance of the injector]
 */
class Injector implements DependencyInjector {
  private singletons = new WeakMap();

  constructor(private providers: Provider[] = [], private parent?: DependencyInjector) {
    this.addProviders(providers);
  }

  /**
   * Lookup singleton instance using token
   * Optionally create instance and save as singleton if needed
   * If not found, this will search a parent injector (if provided)
   */
  get(token: Token): any {
    var inst = this.findAndMakeInstance(token);
    return inst || (this.parent ? this.parent.get(token) : null);
  }

  /**
   * Create an unshared, non-cached instance of the token;
   * based on the Provider configuration
   * If not found, then consider asking parent injector for the
   * instance
   */
  instanceOf(token: Token, askParent = true): any {
    let result = this.instanceFromRegistry(token);
    if (!result && askParent && this.parent) {
      result = this.parent.instanceOf(token, askParent);
    }
    return result;
  }

  /**
   * Dynamically allow Provider registrations and singleton overwrites
   * Provide an 'restore' function to optionally restore original providers (if replaced),
   * 
   * @param registry Configuration set of Provider(s)
   * @param replace Replace existing provider
   */
  addProviders(registry: Provider[], replace = true): UndoChanges {
    const origProviders = [...this.providers];    
    const cache = replace
      ? this.providers.reduce((list, current) => {
          const isSameToken = newItem => newItem.provide === current.provide;
          const notFound = registry.filter(isSameToken).length < 1;
          return notFound ? list.concat([current]) : list;
        }, [])
      : this.providers;

    this.providers = cache.concat(registry);
    registry.map(it => this.singletons.delete(it.provide));

    return () => this.addProviders(origProviders);
  }

  // *************************************************
  // Private  Methods
  // *************************************************

  /**
   * Find last Provider registration (last one wins)
   */
  private findLastRegistration(token: Token, list: Provider[]) {
    const registry = this.providers.filter(it => it.provide === token);
    return registry.length ? registry[registry.length - 1] : null;
  }

  /**
   * Based on provider registration, create instance of token and save
   * as singleton value.
   * NOTE: do not scan parent since we are caching singletons at this level only.
   * 
   * @param token Class, value, or factory
   */
  private findAndMakeInstance(token: Token): any {
    let result = this.singletons.get(token) || this.instanceOf(token, false);
    result && this.singletons.set(token, result);

    return result;
  }

  private instanceFromRegistry(token:Token): any {
    const provider = this.findLastRegistration(token, this.providers);
    const deps = provider && provider.deps ? provider.deps.map(it => this.instanceOf(it)) : [];
    const makeWithClazz = (clazz: any) => (clazz ? new clazz(...deps) : null);
    const makeWithFactory = (fn: () => any) => (fn ? fn.call(null, deps) : null);

    return provider && ( provider.useValue
      || makeWithClazz(provider.useClass) 
      || makeWithFactory(provider.useFactory)
      || makeWithClazz(provider.provide)  // fallback uses the token as a `class`
    );    
  }
}


/**
 * Internal utility used to normalized Provider entries
 * during a `makeInjector()` call
 * 
 * @param token
 */
function makeClassProvider(token:any): Provider {
  return {
    provide: token,
    useClass: token,
    deps: [...token['deps']],
  };
}
