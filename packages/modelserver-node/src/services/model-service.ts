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
    protected readonly modeluri: string;

    @inject(InternalModelServerClientApi)
    protected readonly client: InternalModelServerClientApi;

    @inject(ValidationManager)
    protected readonly validator: ValidationManager;

    @inject(EditService)
    protected readonly editService: EditService;

    getModelURI(): string {
        return this.modeluri;
    }

    getModel(format?: string): Promise<AnyObject>;
    getModel<M>(typeGuard: TypeGuard<M>, format?: string): Promise<M>;
    getModel<M>(typeGuardOrFormat: TypeGuard<M> | string, format?: string): Promise<M | AnyObject> {
        if (typeof typeGuardOrFormat === 'string') {
            // It's the first signature with a format
            return this.client.get(this.getModelURI(), typeGuardOrFormat);
        }
        if (typeGuardOrFormat) {
            // It's the second signature and the format is easy to default
            return this.client.get(this.getModelURI(), typeGuardOrFormat, format ?? FORMAT_JSON_V2);
        }
        // It's the first signature without a format
        return this.client.get(this.getModelURI(), FORMAT_JSON_V2);
    }

    edit(patch: Operation | Operation[]): Promise<ModelUpdateResult>;
    edit(command: ModelServerCommand): Promise<ModelUpdateResult>;
    edit(patchOrCommand: Operation | Operation[] | ModelServerCommand): Promise<ModelUpdateResult> {
        return this.editService.edit(this.getModelURI(), patchOrCommand);
    }

    undo(): Promise<ModelUpdateResult> {
        return this.client.undo(this.getModelURI());
    }

    redo(): Promise<ModelUpdateResult> {
        return this.client.redo(this.getModelURI());
    }

    openTransaction(): Promise<EditTransaction> {
        return this.client.openTransaction(this.getModelURI());
    }

    validate(): Promise<Diagnostic> {
        return this.validator.validate(this.getModelURI());
    }

    async create<M extends AnyObject>(content: M, format?: string): Promise<M> {
        return this.client.create(this.getModelURI(), content, format ?? FORMAT_JSON_V2).then(success => {
            if (success) {
                return content;
            }
            return Promise.reject('Model not created.');
        });
    }

    save(): Promise<boolean> {
        return this.client.save(this.getModelURI());
    }

    close(): Promise<boolean> {
        return this.client.close(this.getModelURI());
    }

    delete(): Promise<boolean> {
        return this.client.delete(this.getModelURI());
    }
}
