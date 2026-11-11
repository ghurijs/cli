// Views for the '{{name}}' app. A view is a function `(c: Context) => Response` (Hono's Context)
// or a class-based view (`View`, `TemplateView` from '@ghuri/core').
import type { Context } from 'hono'

export function index(c: Context) {
  return c.json({ app: '{{name}}' })
}

// A REST API for a model (@ghuri/rest), registered in src/urls.ts with router.register('posts', PostViewSet):
//
// import { IsAuthenticatedOrReadOnly, ModelViewSet } from '@ghuri/rest'
// import { Post } from './models'
// import { PostSerializer } from './serializers'
//
// export class PostViewSet extends ModelViewSet<Post> {
//   queryset = Post.objects.all()
//   serializerClass = PostSerializer
//   permissionClasses = [IsAuthenticatedOrReadOnly]
// }
