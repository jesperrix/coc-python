// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict'

import { ConfigurationChangeEvent, ExtensionContext, Uri, workspace } from 'coc.nvim'
import path from 'path'
import { Disposable, TextDocument } from 'vscode-languageserver-protocol'
import { IDocumentManager, IWorkspaceService } from '../common/application/types'
import { isTestExecution } from '../common/constants'
import '../common/extensions'
import { IFileSystem } from '../common/platform/types'
import { IConfigurationService } from '../common/types'
import { IInterpreterService } from '../interpreter/contracts'
import { IServiceContainer } from '../ioc/types'
import { ILinterManager, ILintingEngine } from '../linters/types'

export class LinterProvider implements Disposable {
  private context: ExtensionContext
  private disposables: Disposable[]
  private interpreterService: IInterpreterService
  private documents: IDocumentManager
  private configuration: IConfigurationService
  private linterManager: ILinterManager
  private engine: ILintingEngine
  private fs: IFileSystem
  private readonly workspaceService: IWorkspaceService

  public constructor(context: ExtensionContext, serviceContainer: IServiceContainer) {
    this.context = context
    this.disposables = []

    this.fs = serviceContainer.get<IFileSystem>(IFileSystem)
    this.engine = serviceContainer.get<ILintingEngine>(ILintingEngine)
    this.linterManager = serviceContainer.get<ILinterManager>(ILinterManager)
    this.interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService)
    this.documents = serviceContainer.get<IDocumentManager>(IDocumentManager)
    this.configuration = serviceContainer.get<IConfigurationService>(IConfigurationService)
    this.workspaceService = serviceContainer.get<IWorkspaceService>(IWorkspaceService)

    this.disposables.push(this.interpreterService.onDidChangeInterpreter(() => this.engine.lintOpenPythonFiles()))

    this.documents.onDidOpenTextDocument(e => this.onDocumentOpened(e), this.context.subscriptions)
    this.documents.onDidCloseTextDocument(e => this.onDocumentClosed(e), this.context.subscriptions)
    this.documents.onDidSaveTextDocument(e => this.onDocumentSaved(e), this.context.subscriptions)

    const disposable = this.workspaceService.onDidChangeConfiguration(this.lintSettingsChangedHandler.bind(this))
    this.disposables.push(disposable)

    // On workspace reopen we don't get `onDocumentOpened` since it is first opened
    // and then the extension is activated. So schedule linting pass now.
    if (!isTestExecution()) {
      setTimeout(() => this.engine.lintOpenPythonFiles().ignoreErrors(), 1200)
    }
  }

  public dispose() {
    this.disposables.forEach(d => d.dispose())
  }

  private isDocumentOpen(uri: string): boolean {
    return workspace.getDocument(uri) != null
  }

  private lintSettingsChangedHandler(e: ConfigurationChangeEvent) {
    // Look for python files that belong to the specified workspace folder.
    workspace.textDocuments.forEach(document => {
      if (e.affectsConfiguration('python.linting', document.uri)) {
        this.engine.lintDocument(document).ignoreErrors()
      }
    })
  }

  private onDocumentOpened(document: TextDocument): void {
    this.engine.lintDocument(document).ignoreErrors()
  }

  private onDocumentSaved(document: TextDocument): void {
    const settings = this.configuration.getSettings(Uri.parse(document.uri))
    if (document.languageId === 'python' && settings.linting.enabled && settings.linting.lintOnSave) {
      this.engine.lintDocument(document).ignoreErrors()
      return
    }

    this.linterManager.getActiveLinters(false, Uri.parse(document.uri))
      .then(linters => {
        const fileName = path.basename(Uri.parse(document.uri).fsPath).toLowerCase()
        const watchers = linters.filter(info => info.configFileNames.indexOf(fileName) >= 0)
        if (watchers.length > 0) {
          setTimeout(() => this.engine.lintOpenPythonFiles(), 1000)
        }
      }).ignoreErrors()
  }

  private onDocumentClosed(document: TextDocument) {
    if (!document || !Uri.parse(document.uri).fsPath || !document.uri) {
      return
    }
    // Check if this document is still open as a duplicate editor.
    if (!this.isDocumentOpen(document.uri)) {
      this.engine.clearDiagnostics(document)
    }
  }
}
