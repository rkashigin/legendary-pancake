import { COOKIE_NAME } from '../constants';
import {
  Arg,
  Ctx,
  Field,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from 'type-graphql';
import { MyContext } from '../types';
import { User } from '../entities/User';
import argon2 from 'argon2';
import { EntityManager } from '@mikro-orm/knex';
import { UsernamePasswordInput } from './UsernamePasswordInput';
import { validateRegister } from '../utils/validateRegister';

@ObjectType()
class FieldError {
  @Field()
  field: string;

  @Field()
  message: string;
}

@ObjectType()
class UserResponse {
  @Field(() => [FieldError], { nullable: true })
  errors?: FieldError[];

  @Field(() => User, { nullable: true })
  user?: User;
}

@Resolver()
export class UserResolver {
  @Mutation(() => Boolean)
  async forgotPassword(@Arg('email') email: string, @Ctx() { em }: MyContext) {
    const user = await em.findOne(User, { email });
    console.log(user);
  }
  @Query(() => User, { nullable: true })
  async me(@Ctx() { em, req }: MyContext) {
    // you are not logged in
    if (!req.session.userId) {
      return null;
    }

    return await em.findOne(User, { id: req.session.userId });
  }
  @Mutation(() => UserResponse)
  async register(
    @Arg('options') options: UsernamePasswordInput,
    @Ctx() { em, req }: MyContext,
  ): Promise<UserResponse> {
    const errors = validateRegister(options);

    if (errors) {
      return { errors };
    }

    const hashedPassword = await argon2.hash(options.password);

    let user;

    try {
      const result = await (em as EntityManager)
        .createQueryBuilder(User)
        .getKnexQuery()
        .insert({
          username: options.username,
          password: hashedPassword,
          email: options.email,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('*');

      user = result[0];
    } catch (err) {
      // duplicate username error
      if (err.detail.includes('already exists')) {
        return {
          errors: [
            {
              field: 'username',
              message: 'username already taken',
            },
          ],
        };
      }
      console.log('message: ', err.message);
    }

    // store user id session
    req.session.userId = user.id;

    return { user };
  }

  @Mutation(() => UserResponse)
  async login(
    @Arg('usernameOrEmail') usernameOrEmail: string,
    @Arg('password') password: string,
    @Ctx() { em, req }: MyContext,
  ): Promise<UserResponse> {
    const user = await em.findOne(
      User,
      usernameOrEmail.includes('@')
        ? { email: usernameOrEmail }
        : { username: usernameOrEmail },
    );

    if (!user) {
      return {
        errors: [
          {
            field: 'username',
            message: "That username doesn't exist",
          },
        ],
      };
    }

    const valid = await argon2.verify(user.password, password);

    if (!valid) {
      return {
        errors: [
          {
            field: 'password',
            message: 'Password is incorrect',
          },
        ],
      };
    }

    req.session.userId = user.id;

    return { user };
  }

  @Mutation(() => Boolean)
  logout(@Ctx() { req, res }: MyContext) {
    return new Promise((resolve) =>
      req.session.destroy((err) => {
        res.clearCookie(COOKIE_NAME);

        if (err) {
          console.log(err);
          resolve(false);
          return;
        }

        resolve(true);
      }),
    );
  }
}
