/********************************************************************************
 * Copyright (c) 2022 STMicroelectronics.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0, or the MIT License which is
 * available at https://opensource.org/licenses/MIT.
 *
 * SPDX-License-Identifier: EPL-2.0 OR MIT
 *******************************************************************************/
import { ModelServerCommand } from '@eclipse-emfcloud/modelserver-client';
import { Logger, Transaction, TriggerProvider } from '@eclipse-emfcloud/modelserver-plugin-ext';
import { assert } from '@sinonjs/referee';
import { expect } from 'chai';
import { Operation } from 'fast-json-patch';
import { Container } from 'inversify';
import * as sinon from 'sinon';
import * as URI from 'urijs';

import { TriggerProviderRegistry } from './trigger-provider-registry';

describe('TriggerProviderRegistry', () => {
    let registry: TriggerProviderRegistry;

    beforeEach(() => {
        const logger: Logger = {
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            debug: () => {},
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            info: () => {}
        } as any;

        const container = new Container();
        container.bind(Logger).toConstantValue(logger);
        container.bind(TriggerProviderRegistry).toSelf();
        registry = container.get(TriggerProviderRegistry);
    });

    it('manages registrations with #register', () => {
        expect(registry.hasProviders()).to.be.false;

        const provider = {
            canTrigger: () => true,
            getTriggers: () => []
        };
        const id = registry.register(provider);

        expect(registry.hasProviders()).to.be.true;

        registry.unregister(id, provider);

        expect(registry.hasProviders()).to.be.false;
    });

    describe('provider aggregation in #getProvider', () => {
        const provider1 = {
            canTrigger: (modelURI: URI) => modelURI.equals('test:a'),
            getTriggers: (): Operation[] => [{ op: 'replace', path: '/foo/bar/name', value: 'Provider 1' }]
        };
        const provider2 = {
            canTrigger: (modelURI: URI) => modelURI.protocol() === 'test',
            getTriggers: (): Operation[] => [{ op: 'remove', path: '/foo/bar/things/2' }]
        };

        let registrations: () => void;

        beforeEach(() => {
            registrations = registerProviders(registry, provider1, provider2);
        });
        afterEach(() => registrations());

        it('no provider matches', () => {
            const provider = registry.getProvider(new URI('none:a'), [{ op: 'replace', path: '/foo/bar/size', value: 42 }]);
            expect(provider).to.be.undefined;
        });

        it('one provider matches', () => {
            const provider = registry.getProvider(new URI('test:b'), [{ op: 'replace', path: '/foo/bar/size', value: 42 }]);
            expect(provider).to.be.equal(provider2);
        });

        it('multiple providers match', async () => {
            const provider = registry.getProvider(new URI('test:a'), [{ op: 'replace', path: '/foo/bar/size', value: 42 }]);
            expect(provider).to.exist;
            const trigger = await provider.getTriggers(new URI('test:a'), [{ op: 'replace', path: '/foo/bar/size', value: 42 }]);
            expect(trigger).to.be.a('function');

            const transaction = trigger as Transaction;
            const counter = new AsyncCounter();
            const executor = sinon.spy({
                execute: async (modelUri: URI, command: ModelServerCommand) => counter.tick({ success: true }),
                applyPatch: async (patch: Operation | Operation[]) => counter.tick({ success: true })
            });

            await transaction(executor);

            expect(counter.count).to.be.equal(2);
            assert(executor.applyPatch.calledWith(sinon.match.every(sinon.match({ path: '/foo/bar/name' }))));
            assert(executor.applyPatch.calledWith(sinon.match.every(sinon.match({ path: '/foo/bar/things/2' }))));
        });
    });
});

function registerProviders(registry: TriggerProviderRegistry, ...providers: TriggerProvider[]): () => void {
    const registrations = providers.map(provider => ({ id: registry.register(provider), provider }));

    return () => registrations.forEach(reg => registry.unregister(reg.id, reg.provider));
}

class AsyncCounter {
    count = 0;

    async tick<T>(action?: T | (() => T)): Promise<T | undefined> {
        return new Promise(resolve => {
            setTimeout(() => {
                this.count = this.count + 1;
                if (typeof action === 'function') {
                    resolve((action as () => T)());
                }
                return resolve(action as T);
            }, 5);
        });
    }
}
