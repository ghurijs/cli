import { describe, expect, it } from 'vitest'
import { outputName, renderString, TemplateError } from '../src/render'

describe('renderString', () => {
  it('substitutes variables', () => {
    expect(renderString('hi {{name}} / {{ name }}', { name: 'blog' })).toBe('hi blog / blog')
  })

  it('throws on unknown variables and flags', () => {
    expect(() => renderString('{{nope}}', {})).toThrow(TemplateError)
    expect(() => renderString('{{#if nope}}x{{/if}}', {})).toThrow(/Unknown template flag/)
  })

  it('renders conditionals, else, negation and nesting; standalone tag lines vanish', () => {
    const tpl =
      'a\n{{#if d1}}\nD1\n{{else}}\nOTHER\n{{/if}}\n{{#if !d1}}not\n{{/if}}z{{#if cf}}[{{#if d1}}d{{/if}}]{{/if}}\n'
    expect(renderString(tpl, { d1: true, cf: true })).toBe('a\nD1\nz[d]\n')
    expect(renderString(tpl, { d1: false, cf: false })).toBe('a\nOTHER\nnot\nz\n')
  })

  it('leaves JSX-style double braces alone', () => {
    expect(renderString('<div style={{ color: "red" }} />', {})).toBe('<div style={{ color: "red" }} />')
  })
})

describe('outputName', () => {
  it('maps _dotfiles and .tpl', () => {
    expect(outputName('_gitignore')).toBe('.gitignore')
    expect(outputName('_dev.vars.example')).toBe('.dev.vars.example')
    expect(outputName('package.json.tpl')).toBe('package.json')
    expect(outputName('src/__init__.ts')).toBe('src/__init__.ts')
  })
})
