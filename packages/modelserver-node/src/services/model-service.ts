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
    AnyObject,
    Diagnostic,
    FORMAT_JSON_V2,
    ModelServerCommand,
    ModelUpdateResult,
    TypeGuard
} from '@eclipse-emfcloud/modelserver-client';
import { EditTransaction, Logger, ModelService } from '@eclipse-emfcloud/modelserver-plugin-ext';
import { Operation } from 'fast-json-patch';
import { inject, injectable, named } from 'inversify';
import * as URI from 'urijs';

import { InternalModelServerClientApi } from '../client/model-server-client';
import { EditService } from './edit-service';
import { ValidationManager } from './validation-manager';

/** Injection key for the model URI that the model service accesses. */
export const MODEL_URI = Symbol('MODEL_URI');

@injectable()
export class DefaultModelService implements ModelService {
    @inject(Logger)
    @named(DefaultModelService.name)
    protected readonly logger: Logger;

    @inject(MODEL_URI)
    protected readonly modeluri: URI;

    @inject(InternalModelServerClientApi)
    protected readonly client: InternalModelServerClientApi;

    @inject(ValidationManager)
    protected readonly validator: ValidationManager;

    @inject(EditService)
    protected readonly editService: EditService;

    getModelURI(): URI {
        return this.modeluri;
    }

    getModel(format?: string): Promise<AnyObject>;
    getModel<M>(typeGuard: TypeGuard<M>, format?: string): Promise<M>;
    getModel<M>(typeGuardOrFormat: TypeGuard<M> | string, format?: string): Promise<M | AnyObject> {
        if (typeof typeGuardOrFormat === 'string') {
            // It's the first signature with a format
            return this.client.get(this.getModelURI().toString(), typeGuardOrFormat);
        }
        if (typeGuardOrFormat) {
            // It's the second signature and the format is easy to default
            return this.client.get(this.getModelURI().toString(), typeGuardOrFormat, format ?? FORMAT_JSON_V2);
        }
        // It's the first signature without a format
        return this.client.get(this.getModelURI().toString(), FORMAT_JSON_V2);
    }

    edit(patch: Operation | Operation[]): Promise<ModelUpdateResult>;
    edit(command: ModelServerCommand): Promise<ModelUpdateResult>;
    edit(patchOrCommand: Operation | Operation[] | ModelServerCommand): Promise<ModelUpdateResult> {
        return this.editService.edit(this.getModelURI().toString(), patchOrCommand);
    }

    undo(): Promise<ModelUpdateResult> {
        return this.client.undo(this.getModelURI().toString());
    }

    redo(): Promise<ModelUpdateResult> {
        return this.client.redo(this.getModelURI().toString());
    }

    openTransaction(): Promise<EditTransaction> {
        return this.client.openTransaction(this.getModelURI().toString());
    }

    validate(): Promise<Diagnostic> {
        return this.validator.validate(this.getModelURI().toString());
    }

    async create<M extends AnyObject>(content: M, format?: string): Promise<M> {
        return this.client.create(this.getModelURI().toString(), content, format ?? FORMAT_JSON_V2).then(success => {
            if (success) {
                return content;
            }
            return Promise.reject('Model not created.');
        });
    }

    save(): Promise<boolean> {
        return this.client.save(this.getModelURI().toString());
    }

    close(): Promise<boolean> {
        return this.client.close(this.getModelURI().toString());
    }

    delete(): Promise<boolean> {
        return this.client.delete(this.getModelURI().toString());
    }
}
