/**
 * Code Parser using Tree-sitter and ts-morph
 * Extracts AST, functions, classes, dependencies
 */

import Parser from 'tree-sitter';
import ts from 'tree-sitter-typescript';
import { Project, ClassDeclaration, FunctionDeclaration, SourceFile } from 'ts-morph';
import fg from 'fast-glob';
import ignore from 'ignore';
import { logger } from '../utils/logger.js';

export interface ParseResult {
  files: FileInfo[];
  functions: FunctionInfo[];
  classes: ClassInfo[];
  dependencies: DependencyInfo[];
}

export interface FileInfo {
  path: string;
  language: string;
  loc: number;
  complexity: number;
  imports: string[];
  exports: string[];
}

export interface FunctionInfo {
  id: string;
  name: string;
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  parameters: string[];
  returnType?: string;
  complexity: number;
  calls: string[];
  body: string;
}

export interface ClassInfo {
  id: string;
  name: string;
  file: string;
  line: number;
  methods: string[];
  extends?: string;
  implements?: string[];
  properties: string[];
}

export interface DependencyInfo {
  from: string;
  to: string;
  type: 'import' | 'call' | 'extends' | 'implements';
}

export class CodeParser {
  private parser: Parser;
  private project: Project;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(ts.typescript);
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        skipLibCheck: true
      }
    });
  }

  async parse(options: {
    repoPath: string;
    language: string;
    exclude: string[];
  }): Promise<ParseResult> {
    const { repoPath, language, exclude } = options;
    
    // Find all source files
    const files = await this.findFiles(repoPath, language, exclude);
    logger.info({ fileCount: files.length }, 'Found source files');
    
    const results: ParseResult = {
      files: [],
      functions: [],
      classes: [],
      dependencies: []
    };
    
    // Parse each file
    for (const file of files) {
      try {
        const result = await this.parseFile(file, repoPath);
        results.files.push(...result.files);
        results.functions.push(...result.functions);
        results.classes.push(...result.classes);
        results.dependencies.push(...result.dependencies);
      } catch (error) {
        logger.warn({ file, error }, 'Failed to parse file');
      }
    }
    
    return results;
  }

  private async findFiles(repoPath: string, language: string, exclude: string[]): Promise<string[]> {
    const extensions = this.getExtensionsForLanguage(language);
    
    const ig = ignore().add(exclude);
    
    const files = await fg(`**/*.{${extensions.join(',')}}`, {
      cwd: repoPath,
      ignore: ['node_modules/**', 'dist/**', 'build/**', '.git/**', '**/*.test.*', '**/*.spec.*']
    });
    
    return files.filter(f => !ig.ignores(f));
  }

  private getExtensionsForLanguage(language: string): string[] {
    switch (language) {
      case 'typescript':
        return ['ts', 'tsx'];
      case 'javascript':
        return ['js', 'jsx'];
      case 'python':
        return ['py'];
      case 'rust':
        return ['rs'];
      case 'go':
        return ['go'];
      default:
        return ['ts', 'tsx', 'js', 'jsx'];
    }
  }

  private async parseFile(filePath: string, repoPath: string): Promise<ParseResult> {
    const fullPath = `${repoPath}/${filePath}`;
    
    // Use ts-morph for TypeScript/JavaScript
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.js')) {
      return this.parseTypeScriptFile(fullPath, filePath);
    }
    
    // Use tree-sitter for other languages
    return this.parseWithTreeSitter(fullPath, filePath);
  }

  private parseTypeScriptFile(fullPath: string, relativePath: string): ParseResult {
    const sourceFile = this.project.addSourceFileAtPath(fullPath);
    
    const result: ParseResult = {
      files: [],
      functions: [],
      classes: [],
      dependencies: []
    };
    
    // File info
    const fileInfo = this.extractFileInfo(sourceFile, relativePath);
    result.files.push(fileInfo);
    
    // Classes
    const classes = this.extractClasses(sourceFile, relativePath);
    result.classes.push(...classes);
    
    // Functions
    const functions = this.extractFunctions(sourceFile, relativePath);
    result.functions.push(...functions);
    
    // Dependencies
    const deps = this.extractDependencies(sourceFile, relativePath);
    result.dependencies.push(...deps);
    
    return result;
  }

  private extractFileInfo(sourceFile: SourceFile, relativePath: string): FileInfo {
    const text = sourceFile.getFullText();
    const lines = text.split('\n');
    
    return {
      path: relativePath,
      language: 'typescript',
      loc: lines.length,
      complexity: this.calculateFileComplexity(sourceFile),
      imports: sourceFile.getImportDeclarations().map(i => i.getModuleSpecifierValue()),
      exports: sourceFile.getExportDeclarations().map(e => e.getModuleSpecifierValue())
    };
  }

  private extractClasses(sourceFile: SourceFile, relativePath: string): ClassInfo[] {
    return sourceFile.getClasses().map(cls => ({
      id: `${relativePath}:${cls.getName()}`,
      name: cls.getName() || 'Anonymous',
      file: relativePath,
      line: cls.getNameNode()?.getStartLineNumber() || 0,
      methods: cls.getMethods().map(m => m.getName()),
      extends: cls.getBaseClass()?.getName(),
      implements: cls.getImplements().map(i => i.getText()),
      properties: cls.getProperties().map(p => p.getName())
    }));
  }

  private extractFunctions(sourceFile: SourceFile, relativePath: string): FunctionInfo[] {
    const functions: FunctionInfo[] = [];
    
    // Top-level functions
    sourceFile.getFunctions().forEach(fn => {
      const nameNode = fn.getNameNode();
      functions.push({
        id: `${relativePath}:${fn.getName() || 'anonymous'}`,
        name: fn.getName() || 'anonymous',
        file: relativePath,
        line: fn.getStartLineNumber(),
        column: fn.getStartColumn(),
        endLine: fn.getEndLineNumber(),
        endColumn: fn.getEndColumn(),
        parameters: fn.getParameters().map(p => p.getName()),
        returnType: fn.getReturnTypeNode()?.getText(),
        complexity: this.calculateFunctionComplexity(fn),
        calls: this.extractFunctionCalls(fn),
        body: fn.getBody()?.getText() || ''
      });
    });
    
    return functions;
  }

  private extractDependencies(sourceFile: SourceFile, relativePath: string): DependencyInfo[] {
    const deps: DependencyInfo[] = [];
    
    // Import dependencies
    sourceFile.getImportDeclarations().forEach(imp => {
      const moduleSpec = imp.getModuleSpecifierValue();
      deps.push({
        from: relativePath,
        to: moduleSpec,
        type: 'import'
      });
    });
    
    return deps;
  }

  private parseWithTreeSitter(fullPath: string, relativePath: string): ParseResult {
    // Fallback for non-TypeScript files
    return {
      files: [{
        path: relativePath,
        language: 'unknown',
        loc: 0,
        complexity: 0,
        imports: [],
        exports: []
      }],
      functions: [],
      classes: [],
      dependencies: []
    };
  }

  private calculateFileComplexity(sourceFile: SourceFile): number {
    // Simple complexity based on control flow statements
    const text = sourceFile.getFullText();
    const complexityKeywords = ['if', 'else', 'for', 'while', 'switch', 'case', 'catch', 'try'];
    let complexity = 1;
    
    complexityKeywords.forEach(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'g');
      const matches = text.match(regex);
      if (matches) complexity += matches.length;
    });
    
    return complexity;
  }

  private calculateFunctionComplexity(fn: FunctionDeclaration): number {
    let complexity = 1;
    const body = fn.getBody()?.getText() || '';
    
    const complexityKeywords = ['if', 'else', 'for', 'while', 'switch', 'case', 'catch', '&&', '||', '?'];
    complexityKeywords.forEach(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'g');
      const matches = body.match(regex);
      if (matches) complexity += matches.length;
    });
    
    return complexity;
  }

  private extractFunctionCalls(fn: FunctionDeclaration): string[] {
    const body = fn.getBody();
    if (!body) return [];
    
    const calls: string[] = [];
    const text = body.getText();
    
    // Simple regex-based call extraction
    const callRegex = /(\w+)\s*\(/g;
    let match;
    while ((match = callRegex.exec(text)) !== null) {
      calls.push(match[1]);
    }
    
    return [...new Set(calls)];
  }
}
