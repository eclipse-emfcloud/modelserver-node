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
import {
    CompoundCommand,
    ModelServerCommand,
    ModelServerNotificationListenerV2,
    ModelServerObjectV2,
    NotificationSubscriptionListenerV2,
    Operations,
    SetCommand,
    WARNING
} from '@eclipse-emfcloud/modelserver-client';
import {
    CommandProvider,
    ModelServerClientApi,
    ModelService,
    ModelServiceFactory,
    TriggerProvider
} from '@eclipse-emfcloud/modelserver-plugin-ext';
import * as chai from 'chai';
import { expect } from 'chai';
import * as chaiLike from 'chai-like';
import { getValueByPointer, Operation } from 'fast-json-patch';
import { Container } from 'inversify';
import * as URI from 'urijs';

import { CommandProviderRegistry } from '../command-provider-registry';
import { TriggerProviderRegistry } from '../trigger-provider-registry';
import { ValidationProviderRegistry } from '../validation-provider-registry';
import { assumeThatCondition, awaitClosed, findDiagnostic, listenForFullUpdate, requireArray } from './test-helpers';
import { CoffeeMachine, isCoffeeMachine } from './test-model-helper';
import { ServerFixture } from './test-server-fixture';

/**
 * Integration tests for the `ModelService` API.
 *
 * These require the Example Coffee Model server from the `eclipse-emfcloud/emfcloud-modelserver` project to be
 * running as the upstream Java server, listening on port 8081.
 */

chai.use(chaiLike);

// eslint-disable-next-line @typescript-eslint/no-empty-function
const pass = (): void => {};

describe('DefaultModelService', () => {
    let assumeThat: (...args: Parameters<typeof assumeThatCondition>) => void;
    const modelURI = new URI('SuperBrewer3000.coffee');
    const diagnosticSource = 'Mocha Tests';
    let client: ModelServerClientApi;
    let container: Container; // An independent client for model fixture maintenance
    const server: ServerFixture = new ServerFixture(c => (container = c));
    server.requireUpstreamServer();

    let modelService: ModelService;
    let triggerReg: TriggerProviderRegistry;
    let commandReg: CommandProviderRegistry;

    beforeEach(function () {
        assumeThat = assumeThatCondition.bind(this);
        const modelServiceFactory: ModelServiceFactory = container.get(ModelServiceFactory);
        modelService = modelServiceFactory(modelURI);
        client = container.get(ModelServerClientApi);
        triggerReg = container.get(TriggerProviderRegistry);
        commandReg = container.get(CommandProviderRegistry);

        const validationReg = container.get<ValidationProviderRegistry>(ValidationProviderRegistry);
        validationReg.register({
            canValidate: () => true,
            validate: model => ({
                id: model.$id,
                code: 1,
                severity: WARNING,
                source: diagnosticSource,
                message: 'This is a fake warning.',
                data: [],
                children: []
            })
        });
    });

    it('getModelURI()', () => {
        expect(modelService.getModelURI()).to.be.eq(modelURI);
    });

    it('Model()', async () => {
        const model = await modelService.getModel();

        expect(model).to.be.an('object');
        expect(model).to.haveOwnProperty('$type', CoffeeMachine.TYPE);
    });

    it('getModel(format)', async () => {
        const model = await modelService.getModel('json');

        expect(model).to.be.an('object');
        expect(model).to.haveOwnProperty('eClass', CoffeeMachine.TYPE);
    });

    it('getModel(typeGuard)', async () => {
        const model = await modelService.getModel(isCoffeeMachine);

        expect(model).to.haveOwnProperty('name', 'Super Brewer 3000');

        const workflows = model['workflows'];
        expect(workflows).to.be.an('array').that.is.not.empty;
        expect(workflows[0]).to.be.like({ name: 'Simple Workflow', nodes: [{ name: 'PreHeat' }] });
    });

    it('edit(patch)', async () => {
        const patch: Operation = { op: 'replace', path: '/workflows/0/name', value: 'New Name' };

        const result = await modelService.edit(patch);

        try {
            expect(result.patch).to.be.like([patch]);
        } finally {
            // Don't interfere with other tests
            await client.undo(modelURI.toString());
        }
    });

    it('edit(patch) includes triggers', async () => {
        const unregister = registerTrigger(triggerReg);

        const patch: Operation = { op: 'replace', path: '/workflows/0/name', value: 'New Name' };
        const trigger: Operation = { op: 'replace', path: '/workflows/0/name', value: 'New Name 1' };

        try {
            const result = await modelService.edit(patch);
            expect(result.success).to.be.true;
            expect(result.patch).to.be.like([patch, trigger]);
        } finally {
            unregister();

            // Don't interfere with other tests
            await client.undo(modelURI.toString());
        }
    });

    it('edit(command)', async () => {
        const model = await client.get(modelURI.toString());
        expect(model['workflows']).to.be.an('array').that.is.not.empty;
        const workflows = requireArray(model, 'workflows');
        const workflow = workflows[0] as ModelServerObjectV2;
        const nodes = requireArray(workflow, 'nodes');
        const preheatTask = nodes[0] as ModelServerObjectV2;

        const command = new CompoundCommand();
        command.type = 'test-set-name';
        command.setProperty('newName', 'Heat Up First');
        command.owner = {
            eClass: preheatTask.$type,
            $ref: `${modelURI}#${preheatTask.$id}`
        };

        const unregister = registerCommand(commandReg);

        try {
            const result = await modelService.edit(command);
            expect(result.success).to.be.true;
            expect(result.patch).to.be.like([{ op: 'replace', path: '/workflows/0/nodes/0/name', value: 'Heat Up First' }]);
        } finally {
            unregister();
            // Don't interfere with other tests
            await client.undo(modelURI.toString());
        }
    });

    it('edit(command) includes triggers', async () => {
        const model = await client.get(modelURI.toString());
        expect(model['workflows']).to.be.an('array').that.is.not.empty;
        const workflows = requireArray(model, 'workflows');
        const workflow = workflows[0] as ModelServerObjectV2;
        const nodes = requireArray(workflow, 'nodes');
        const preheatTask = nodes[0] as ModelServerObjectV2;

        const command = new CompoundCommand();
        command.type = 'test-set-name';
        command.setProperty('newName', 'Heat Up First');
        command.owner = {
            eClass: preheatTask.$type,
            $ref: `${modelURI}#${preheatTask.$id}`
        };

        const unregisterCommand = registerCommand(commandReg);
        const unregisterTrigger = registerTrigger(triggerReg);

        try {
            const result = await modelService.edit(command);
            expect(result.success).to.be.true;
            expect(result.patch).to.be.like([
                { op: 'replace', path: '/workflows/0/nodes/0/name', value: 'Heat Up First' },
                { op: 'replace', path: '/workflows/0/nodes/0/name', value: 'Heat Up First 1' }
            ]);
        } finally {
            unregisterTrigger();
            unregisterCommand();
            // Don't interfere with other tests
            await client.undo(modelURI.toString());
        }
    });

    it('undo()', async () => {
        const patch: Operation = { op: 'replace', path: '/workflows/0/name', value: 'New Name' };

        const editResult = await modelService.edit(patch);
        assumeThat(editResult.success, 'Edit failed.');

        const undoResult = await modelService.undo();

        expect(undoResult.success).to.be.true;
        expect(undoResult.patch).to.be.like([{ op: 'replace', path: '/workflows/0/name', value: 'Simple Workflow' }]);
    });

    it('redo()', async () => {
        const patch: Operation = { op: 'replace', path: '/workflows/0/name', value: 'New Name' };

        const editResult = await modelService.edit(patch);
        assumeThat(editResult.success, 'Edit failed.');
        const undoResult = await modelService.undo();
        assumeThat(undoResult.success, 'Undo failed.');

        const redoResult = await modelService.redo();

        try {
            expect(redoResult.success).to.be.true;
            expect(redoResult.patch).to.be.like([patch]);
        } finally {
            // Don't interfere with other tests
            await client.undo(modelURI.toString());
        }
    });

    it('validate()', async () => {
        const result = findDiagnostic(await modelService.validate(), diagnosticSource);

        expect(result).to.be.like({ severity: WARNING, message: 'This is a fake warning.' });
    });

    it('openTransaction() edit and roll back', async () => {
        const patch: Operation = { op: 'replace', path: '/workflows/0/name', value: 'New Name' };

        const transaction = await modelService.openTransaction();
        expect(transaction.isOpen()).to.be.true;
        expect(transaction.getModelURI().toString()).to.be.string(modelURI.toString());

        const result = await transaction.edit(patch);
        expect(result.success).to.be.true;
        expect(result.patch).to.be.like([patch]);

        await transaction.rollback('Testing roll-back.');
        await awaitClosed(transaction);

        const model = await client.get(modelURI.toString());
        const actual = getValueByPointer(model, '/workflows/0/name');
        expect(actual).to.be.string('Simple Workflow');
    });

    it('openTransaction() edit and commit', async () => {
        const patch: Operation = { op: 'replace', path: '/workflows/0/name', value: 'New Name' };

        const transaction = await modelService.openTransaction();
        expect(transaction.isOpen()).to.be.true;

        const result = await transaction.edit(patch);
        expect(result.success).to.be.true;
        expect(result.patch).to.be.like([patch]);

        await transaction.commit();

        try {
            await awaitClosed(transaction);
            const model = await client.get(modelURI.toString());
            const actual = getValueByPointer(model, '/workflows/0/name');
            expect(actual).to.be.string('New Name');
        } finally {
            // Don't interfere with other tests
            await client.undo(modelURI.toString());
        }
    });

    it('openTransaction() child edit and roll back', async () => {
        const patch: Operation = { op: 'replace', path: '/workflows/0/name', value: 'New Name' };

        const transaction = await modelService.openTransaction();
        assumeThat(transaction.isOpen(), 'Parent transaction not opened.');

        const child = await modelService.openTransaction();
        expect(child.isOpen()).to.be.true;
        expect(child).not.to.be.equal(transaction);

        const result = await child.edit(patch);
        expect(result.success).to.be.true;
        expect(result.patch).to.be.like([patch]);

        await child.rollback('Testing roll-back.');
        await awaitClosed(transaction);

        expect(child.isOpen()).to.be.false;
        expect(transaction.isOpen()).to.be.false;

        const model = await client.get(modelURI.toString());
        const actual = getValueByPointer(model, '/workflows/0/name');
        expect(actual).to.be.string('Simple Workflow');
    });

    it('openTransaction() child edit and commit', async () => {
        const patch: Operation = { op: 'replace', path: '/workflows/0/name', value: 'New Name' };

        const transaction = await modelService.openTransaction();
        assumeThat(transaction.isOpen(), 'Parent transaction not opened.');

        const child = await modelService.openTransaction();
        expect(child.isOpen()).to.be.true;
        expect(child).not.to.be.equal(transaction);

        const result = await child.edit(patch);
        expect(result.success).to.be.true;
        expect(result.patch).to.be.like([patch]);

        const committed = await child.commit();
        expect(committed.patch).to.be.like([patch]);

        expect(transaction.isOpen()).to.be.true;
        const aggregate = await transaction.commit();
        expect(aggregate.patch).to.be.like([patch]);

        try {
            await awaitClosed(transaction);
            const model = await client.get(modelURI.toString());
            const actual = getValueByPointer(model, '/workflows/0/name');
            expect(actual).to.be.string('New Name');
        } finally {
            // Don't interfere with other tests
            await client.undo(modelURI.toString());
        }
    });

    it('openTransaction() child edit and commit but roll back parent', async () => {
        const patch: Operation = { op: 'replace', path: '/workflows/0/name', value: 'New Name' };

        const transaction = await modelService.openTransaction();
        assumeThat(transaction.isOpen(), 'Parent transaction not opened.');

        const child = await modelService.openTransaction();
        expect(child.isOpen()).to.be.true;
        expect(child).not.to.be.equal(transaction);

        const result = await child.edit(patch);
        expect(result.success).to.be.true;
        expect(result.patch).to.be.like([patch]);

        const committed = await child.commit();
        expect(committed.patch).to.be.like([patch]);

        expect(transaction.isOpen()).to.be.true;
        await transaction.rollback('Testing parent roll-back.');
        await awaitClosed(transaction);

        const model = await client.get(modelURI.toString());
        const actual = getValueByPointer(model, '/workflows/0/name');
        expect(actual).to.be.string('Simple Workflow');
    });

    describe('Destructive APIs', () => {
        let newModelURI: URI;
        const modelContent: Partial<CoffeeMachine> = {
            $type: CoffeeMachine.TYPE,
            name: 'New Coffee Machine'
        };
        let newModelService: ModelService;

        beforeEach(function () {
            newModelURI = new URI('ModelServiceTest.coffee');
            assumeThat = assumeThatCondition.bind(this);
            const modelServiceFactory: ModelServiceFactory = container.get(ModelServiceFactory);
            newModelService = modelServiceFactory(newModelURI);
        });

        afterEach(async () => {
            const uris = await client.getModelUris();
            if (!uris.includes(newModelURI.toString())) {
                return Promise.resolve();
            } else {
                // Clean up this model
                return client.delete(newModelURI.toString()).catch(pass);
            }
        });

        it('create()', async () => {
            const result = await newModelService.create(modelContent);
            expect(result).to.be.like(modelContent);

            const actual = await client.get(newModelURI.toString(), isCoffeeMachine);
            expect(actual).to.be.like(modelContent);
        });

        it('close()', async () => {
            const model = await newModelService.create(modelContent);
            assumeThat(!!model, 'Model not created.');

            const { ready, done: closed } = listenForFullUpdate(client, newModelURI, 'close');
            await ready;

            try {
                const result = await newModelService.close();
                expect(result).to.be.true;

                const actual = await closed;
                expect(actual).to.be.true;
            } finally {
                client.unsubscribe(newModelURI.toString());
            }
        });

        it('save()', async () => {
            const model = await newModelService.create(modelContent);
            assumeThat(!!model, 'Model not created.');

            const patch: Operation = { op: 'replace', path: '/name', value: 'New Name' };
            const edited = await client.edit(newModelURI.toString(), patch);
            assumeThat(edited.success, 'Model edit failed.');

            const dirtyState = new Promise<boolean>(resolve => {
                const listener: ModelServerNotificationListenerV2 = {
                    onError: notif => {
                        expect.fail(`Error in ${notif.modelUri} subscription: ${notif.error}`);
                    },
                    onDirtyStateChanged: notif => {
                        if (!notif.isDirty) {
                            resolve(notif.isDirty);
                        }
                    }
                };
                client.subscribe(newModelURI.toString(), new NotificationSubscriptionListenerV2(listener));
            });

            try {
                const result = await newModelService.save();
                expect(result).to.be.true;

                const actual = await dirtyState;
                expect(actual).to.be.false;
            } finally {
                client.unsubscribe(newModelURI.toString());
            }
        });

        it('delete()', async () => {
            const model = await newModelService.create(modelContent);
            assumeThat(!!model, 'Model not created.');

            const { ready, done: deleted } = listenForFullUpdate(client, newModelURI, 'delete');
            await ready;

            try {
                const result = await newModelService.delete();
                expect(result).to.be.true;

                const actual = await deleted;
                expect(actual).to.be.true;
            } finally {
                client.unsubscribe(newModelURI.toString());
            }
        });
    });
});

/**
 * Register a test trigger.
 *
 * @param triggerRegistry the trigger registry
 * @returns a function that unregisters the test trigger
 */
function registerTrigger(triggerRegistry: TriggerProviderRegistry): () => void {
    const endsWithNumber = (s: string): boolean => /\d+$/.test(s);

    const triggerProvider: TriggerProvider = {
        canTrigger: () => true,
        getTriggers: (_modelURI, modelDelta) => {
            if (modelDelta.length === 1 && Operations.isReplace(modelDelta[0], 'string') && !endsWithNumber(modelDelta[0].value)) {
                return [
                    {
                        op: 'replace',
                        path: modelDelta[0].path,
                        value: `${modelDelta[0].value} 1`
                    }
                ];
            }
            return [];
        }
    };

    const id = triggerRegistry.register(triggerProvider);

    return () => triggerRegistry.unregister(id, triggerProvider);
}

/**
 * Register a test command.
 *
 * @param commandRegistry the command registry
 * @returns a function that unregisters the test command
 */
function registerCommand(commandRegistry: CommandProviderRegistry): () => void {
    const provider: CommandProvider = {
        canHandle: () => true,
        getCommands: (_modelUri, customCommand: ModelServerCommand) =>
            new SetCommand(customCommand.owner!, 'name', [customCommand.getProperty('newName') as string])
    };
    commandRegistry.register('test-set-name', provider);

    return () => commandRegistry.unregister('test-set-name', provider);
}
