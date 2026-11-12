// The project's GraphQL schema (graphene-django's schema.py), served at /graphql/ (src/urls.ts) and set as
// GRAPHQL.SCHEMA in settings. Merge every app's Query / Mutation classes here, e.g. after `ghuri startapp blog`
// (see the commented example in src/blog/schema.ts):
//   import { BlogMutation, BlogQuery } from './blog/schema'
//   export const schema = new Schema({ query: [ProjectQuery, BlogQuery], mutation: [BlogMutation] })
// The schema is built on first use, so importing it from settings.ts is fine.
import { Field, Query, Schema, String as GString } from '@ghuri/graphql'

class ProjectQuery extends Query {
  static fields = {
    hello: Field(GString, { resolve: () => 'Hello from {{name}}!' }),
  }
}

export const schema = new Schema({ query: [ProjectQuery] })
