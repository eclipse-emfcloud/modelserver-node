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
import { ModelServerClientV2 } from '@eclipse-emfcloud/modelserver-client';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import { Container } from 'inversify';

import { createContainer } from '../di';
import { ModelServer } from '../server';

/** A representation of the upstream _Model Server_, which may or may not be available to tests that need it. */
class UpstreamServer {
    /** The upstream server's base URL. */
    protected readonly baseURL = 'http://localhost:8081/api/v2';

    /**
     * Test whether the upstream server is available. If not, then call the `ifNot` call-back.
     * The result of the test is cached for future invocations.
     *
     * @param ifNot a call-back to invoke in the case that the upstream server is not available
     */
    async testAvailable(ifNot: () => void): Promise<void> {
        const upstream = new ModelServerClientV2();
        upstream.initialize(this.baseURL);

        return upstream
            .ping()
            .then(() => {
                this.testAvailable = () => Promise.resolve();
            })
            .catch(() => {
                console.log('*** Upstream Java server is not running. Please launch it on port 8081 before running tests.');
                ifNot();
                this.testAvailable = (_ifNot: () => void) => {
                    _ifNot();
                    return Promise.reject();
                };
            });
    }
}

/** Test fixture wrapping an Inversify-configured _Model Server_ that is started up and stopped for each test case. */
export class ServerFixture {
    static upstream = new UpstreamServer();

    readonly baseUrl: string;
    readonly client: ModelServerClientV2;
    protected server: ModelServer;

    constructor(protected readonly containerConfig?: (container: Container) => void) {
        this.baseUrl = 'http://localhost:8082/api/v2';
        this.client = new ModelServerClientV2();
        this.client.initialize(this.baseUrl, 'json-v2');

        beforeEach(this.setup.bind(this));
        afterEach(this.tearDown.bind(this));
    }

    /**
     * Declare that the test suite requires an upstream _Model Server_ to be running, listening on port 8081.
     */
    requireUpstreamServer(): void {
        before(function (done) {
            ServerFixture.upstream.testAvailable(this.skip.bind(this)).finally(done);
        });
    }

    setup(done: Mocha.Done): void {
        createContainer(8081, 'error')
            .then(container => {
                if (this.containerConfig) {
                    this.containerConfig(container);
                }

                this.server = container.get(ModelServer);
                return this.server.serve(8082, 8081);
            })
            .then(() => done());
    }

    tearDown(done: Mocha.Done): void {
        if (!this.server) {
            // Nothing to stop
            done();
        } else {
            // Don't return a promise
            this.server.stop().finally(done);
        }
    }

    get(path: string, config?: AxiosRequestConfig): Promise<AxiosResponse> {
        const rest = this.client['restClient'];
        return rest.get(path, config);
    }
}
