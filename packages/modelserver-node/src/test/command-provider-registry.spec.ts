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
import { ModelServerCommand, replace } from '@eclipse-emfcloud/modelserver-client';
import { CommandProvider, Logger, Transaction } from '@eclipse-emfcloud/modelserver-plugin-ext';
import { expect } from 'chai';
import { Container } from 'inversify';
import * as URI from 'urijs';

import { CommandProviderRegistry } from '../command-provider-registry';

describe('CommandProviderRegistry', () => {
    let registry: CommandProviderRegistry;
    let logger: Logger;

    beforeEach(() => {
        logger = {
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            debug: () => {},
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            info: () => {}
        } as any;

        const container = new Container();
        container.bind(Logger).toConstantValue(logger);
        container.bind(CommandProviderRegistry).toSelf();
        registry = container.get(CommandProviderRegistry);
    });

    it('manages registrations with #register', () => {
        expect(registry.hasProviders()).to.be.false;

        const commandType = 'test-command';
        const testProvider = new TestCommandProvider();
        registry.register(commandType, testProvider);
        expect(registry.hasProviders()).to.be.true;
        expect(registry.getProviders(commandType)[0]).to.not.be.undefined;

        registry.unregister(commandType, testProvider);
        expect(registry.hasProviders()).to.be.false;
    });
});

class TestCommandProvider implements CommandProvider {
    canHandle(_customCommand: ModelServerCommand): boolean {
        return true;
    }

    getCommands(_modelUri: URI, customCommand: ModelServerCommand): Transaction {
        if (!customCommand.owner) {
            console.error('custom command owner was unexpectedly undefined');
            return async () => false;
        }

        const commandModelUri = new URI(customCommand.owner.$ref).fragment('');

        return async executor => {
            const obj = { $id: 'any-id', $type: 'any-type', label: 'anyLabel' };

            if (obj) {
                const setCommand = replace(commandModelUri, obj, 'label', 'newLabel');
                const executionResult = (await executor.applyPatch(setCommand)).patch;
                if (!executionResult || !executionResult.length) {
                    return false; // Failed to complete the chain, so roll back
                }
                return true;
            }
            return false;
        };
    }
}
