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
import { TriggerProvider } from '@eclipse-emfcloud/modelserver-plugin-ext';
import * as chai from 'chai';
import { expect } from 'chai';
import * as chaiLike from 'chai-like';
import { Operation } from 'fast-json-patch';
import { assert } from 'sinon';
import * as URI from 'urijs';
import * as WebSocket from 'ws';

import { InternalModelServerClientApi, TransactionContext } from '../client/model-server-client';
import { createContainer } from '../di';
import { TriggerProviderRegistry } from '../trigger-provider-registry';
import { awaitClosed, captureMessage, MockMiddleware, provideEndpoint, provideMiddleware, route } from './test-helpers';
import { isCoffeeMachine } from './test-model-helper';
import { ServerFixture } from './test-server-fixture';

/**
 * Integration tests for the server.
 *
 * These require the Example Coffee Model server from the `eclipse-emfcloud/emfcloud-modelserver` project to be
 * running as the upstream Java server, listening on port 8081
 */

chai.use(chaiLike);

describe('Server Integration Tests', () => {
    describe('Requests simply forwarded to upstream', () => {
        let middleware: MockMiddleware;

        const server: ServerFixture = new ServerFixture(container => {
            middleware = provideMiddleware(container);
        });
        server.requireUpstreamServer();
        const { client } = server;

        it('GET /models', async () => {
            const machine = await client.get('SuperBrewer3000.coffee', isCoffeeMachine);
            expect(machine.name).to.be.equal('Super Brewer 3000');
        });

        it('Core route with custom middleware', async () => {
            const pong = await client.ping();
            expect(pong).to.be.true;
            assert.calledOnce(middleware);
        });
    });

    describe('Subscription relays from upstream', () => {
        const server: ServerFixture = new ServerFixture();
        server.requireUpstreamServer();

        it('Subscription connect success message', done => {
            const futureEvent = captureMessage(
                // N.B.: The v1 API uses the relay, not v2
                new WebSocket('ws://localhost:8082/api/v1/subscribe?modeluri=SuperBrewer3000.coffee&timeout=1000')
            );

            futureEvent
                .then(event => {
                    expect(event.data).to.be.a.string;
                    expect(event.data).to.match(/"type"\s*:\s*"success"/);
                    done();
                })
                .catch(done);
        });
    });

    describe('Subscription with validation', () => {
        const server: ServerFixture = new ServerFixture();
        server.requireUpstreamServer();

        it('Initial validation results on connection', done => {
            const futureEvent = captureMessage(
                new WebSocket('ws://localhost:8082/api/v2/subscribe?modeluri=SuperBrewer3000.coffee&timeout=1000&livevalidation=true'),
                msg => msg.data.toString().includes('validationResult')
            );

            futureEvent
                .then(event => {
                    expect(event.data).to.be.a.string;
                    expect(event.data).to.match(/"type"\s*:\s*"validationResult"/);
                    done();
                })
                .catch(done);
        });

        it('Non-validation subscription gets no initial validation state', done => {
            const futureEvent = captureMessage(
                new WebSocket('ws://localhost:8082/api/v2/subscribe?modeluri=SuperBrewer3000.coffee&timeout=1000'),
                msg => msg.data.toString().includes('validationResult')
            );

            futureEvent
                .then(() => done(new Error('Should not have got a validation result message.')))
                .catch(() => done() /* This is the success path. */);
        });
    });

    describe('Custom route provider', () => {
        let middleware: MockMiddleware;

        const server: ServerFixture = new ServerFixture(container => {
            provideEndpoint(
                container,
                '/api/v2/echo',
                route('get', (req, res) => res.json({ message: req.query.message }))
            );
            middleware = provideMiddleware(container, '/api/v2/echo');
        });

        it('GET custom route /echo', done => {
            server
                .get('/echo?message=Hello,%20world')
                .then(res => {
                    expect(res.status).to.be.equal(200);
                    expect(res.data).to.be.like({ message: 'Hello, world' });
                    done();
                })
                .catch(done);
        });

        it('Custom route with custom middleware', done => {
            server
                .get('/echo?message=Hello,%20world')
                .then(res => {
                    assert.calledOnce(middleware);
                    done();
                })
                .catch(done);
        });
    });

    describe('TransactionContext', async () => {
        const server: ServerFixture = new ServerFixture();
        server.requireUpstreamServer();

        let client: InternalModelServerClientApi;
        let transaction: TransactionContext;

        before(async () => {
            // Create an internal client with transaction capability
            client = await createContainer(8081, 'error').then(container => {
                const result: InternalModelServerClientApi = container.get(InternalModelServerClientApi);
                result.initialize();
                return result;
            });
        });

        beforeEach(async () => {
            transaction = await client.openTransaction(new URI('SuperBrewer3000.coffee'));
        });

        afterEach(async () => {
            if (transaction.isOpen()) {
                transaction.rollback('Test completed, rollback.');
                await awaitClosed(transaction);
            } else {
                // Don't interfere with the data expected by other tests
                await client.undo('SuperBrewer3000.coffee');
            }
        });

        it('isOpen()', async () => {
            expect(transaction.isOpen()).to.be.true;
        });

        it('transaction already open', async () => {
            try {
                const duplicate = await client.openTransaction(new URI('SuperBrewer3000.coffee'));
                await duplicate.rollback('Should not have been opened.');
                expect.fail('Should not have been able to open duplicate transaction.');
            } catch (error) {
                // Success case
            }
        });

        it('Aggregation of model update results', async () => {
            const patch1: Operation = { op: 'replace', path: '/workflows/0/name', value: 'New Name' };
            const patch2: Operation = { op: 'replace', path: '/workflows/0/name', value: 'Next New Name' };

            try {
                expect(transaction).to.have.property('getUUID');

                const uuid = await (transaction as any).getUUID();
                expect(uuid).to.be.a('string');

                const update1 = await transaction.applyPatch(patch1);
                expect(update1).to.be.like({ success: true, patch: [patch1] });

                const update2 = await transaction.applyPatch(patch2);
                expect(update2).to.be.like({ success: true, patch: [patch2] });
            } finally {
                const aggregated = await transaction.commit();
                await awaitClosed(transaction);

                expect(aggregated).to.be.like({
                    success: true,
                    patch: [patch1, patch2]
                });
            }
        });

        it('Check format of model update results (json-v2)', async () => {
            const addPatch: Operation = {
                op: 'add',
                path: '/workflows/0/nodes',
                value: {
                    $type: 'http://www.eclipsesource.com/modelserver/example/coffeemodel#//ManualTask',
                    name: 'New ManualTask'
                }
            };

            const updateResult = await transaction.applyPatch(addPatch);
            expect(updateResult).to.be.like({
                success: true,
                patch: [
                    {
                        op: 'add',
                        path: '/workflows/0/nodes/-',
                        value: {
                            $type: 'http://www.eclipsesource.com/modelserver/example/coffeemodel#//ManualTask',
                            $id: '//@workflows.0/@nodes.1',
                            name: 'New ManualTask'
                        }
                    }
                ]
            });
        });
    });

    describe('TransactionContext Robust to Exceptions', async () => {
        const server: ServerFixture = new ServerFixture();
        server.requireUpstreamServer();

        let client: InternalModelServerClientApi;

        before(async () => {
            // Create an internal client with transaction capability and a trigger provider that bombs
            const bomber: TriggerProvider = {
                canTrigger: () => true,
                getTriggers: () => {
                    throw Error('Boom!');
                }
            };
            client = await createContainer(8081, 'error').then(container => {
                const registry: TriggerProviderRegistry = container.get(TriggerProviderRegistry);
                registry.register(bomber);

                const result: InternalModelServerClientApi = container.get(InternalModelServerClientApi);
                result.initialize();

                return result;
            });
        });

        it('Transaction rolled back by failure', async () => {
            const patch: Operation = { op: 'replace', path: '/workflows/0/name', value: 'New Name' };

            const transaction1 = await client.openTransaction(new URI('SuperBrewer3000.coffee'));

            try {
                await transaction1.applyPatch(patch);
                await transaction1.commit();
                expect.fail('Close should have thrown.');
            } catch (error) {
                expect(error.toString()).to.have.string('Boom!');
            }

            // The transaction should have rolled back and so not be open
            await awaitClosed(transaction1);
            expect(transaction1.isOpen()).to.be.false;

            // Should be able to open a new transaction
            const transaction2 = await client.openTransaction(new URI('SuperBrewer3000.coffee'));
            expect(transaction2.isOpen()).to.be.true;

            try {
                const update = await transaction2.applyPatch(patch);
                expect(update).to.be.like({ success: true, patch: [patch] });
            } catch (error) {
                expect.fail(`Should not have failed to execute patch in new transaction: ${error}`);
            } finally {
                transaction2.rollback('Test completed, rollback.');
            }
        });
    });
});
