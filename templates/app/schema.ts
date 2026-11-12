// GraphQL for the '{{name}}' app (@ghuri/graphql, graphene-django style). To use it, create the project with
// `ghuri startproject --graphql` (or `npm install @ghuri/graphql graphql`, add GraphQLConfig to INSTALLED_APPS
// and GraphQLView to src/urls.ts), uncomment below and add the classes to the project schema (src/schema.ts):
//   new Schema({ query: [{{pascalName}}Query], mutation: [{{pascalName}}Mutation] })
//
// import { ConnectionField, ModelMutation, ModelType, Mutation, Node, Query, SerializerMutation } from '@ghuri/graphql'
// import { IsAuthenticated } from '@ghuri/rest'
// import { Post } from './models'
// import { PostSerializer } from './serializers'
//
// export class PostType extends ModelType {
//   static Meta = {
//     model: Post,
//     fields: ['id', 'title', 'body', 'createdAt'],
//     interfaces: [Node],                                // Relay global IDs + connections
//     filterFields: { title: ['exact', 'icontains'] },   // allPosts(filter: { title: { icontains: "x" } })
//     orderBy: ['createdAt', 'title'],                   // allPosts(orderBy: ["-createdAt"])
//   }
// }
//
// export class {{pascalName}}Query extends Query {
//   static fields = {
//     allPosts: ConnectionField(PostType),
//     post: Node.Field(PostType),
//   }
// }
//
// // Validation, create() / update() and permissions come from the REST serializer and permission classes.
// class SavePost extends SerializerMutation {
//   static Meta = { serializerClass: PostSerializer, permissionClasses: [IsAuthenticated] }
// }
// class DeletePost extends ModelMutation {
//   static Meta = { model: Post, operation: 'delete' as const, permissionClasses: [IsAuthenticated] }
// }
//
// export class {{pascalName}}Mutation extends Mutation {
//   static fields = { savePost: SavePost.field(), deletePost: DeletePost.field() }
// }

export {}
