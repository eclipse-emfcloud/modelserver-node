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
import 'reflect-metadata';

import { Container, ContainerModule } from 'inversify';

import { UpstreamConnectionConfig } from './client/model-server-client';

export const LogLevel = Symbol('LogLevel');

/** Enumeration of supported logging levels. */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export async function createContainer(modelServerPort: number, loggingLevel: LogLevel = 'info'): Promise<Container> {
    const result = new Container();
    result.bind(LogLevel).toConstantValue(loggingLevel);
    const modules = loadModules();

    return modules
        .then(resolved => result.load(...resolved))
        .then(() => {
            result.load(modelServerModule(modelServerPort));
            return result;
        });
}

async function loadModules(): Promise<ContainerModule[]> {
    const modules = [require('./logging-module'), require('./server-module'), require('./routes/routing-module')];

    const result = modules.map(module => module.default);
    return Promise.resolve(result);
}

function modelServerModule(modelServerPort: number): ContainerModule {
    return new ContainerModule(bind => {
        bind(UpstreamConnectionConfig).toConstantValue({
            baseURL: 'api/v2/',
            serverPort: modelServerPort,
            hostname: 'localhost'
        });
    });
}
