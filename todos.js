const express = require("express");
const morgan = require("morgan");
const flash = require("express-flash");
const session = require("express-session");
const { body, validationResult } = require("express-validator");
const store = require("connect-loki");
const SessionPersistence = require("./lib/pg-persistence");
const catchError = require("./lib/catch-error");

const app = express();
const host = "localhost";
const port = 3001;
const LokiStore = store(session);

app.set("views", "./views");
app.set("view engine", "pug");

app.use(morgan("common"));
app.use(express.static("public"));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  cookie: {
    httpOnly: true,
    maxAge: 31 * 24 * 60 * 60 * 1000, // 31 days in millseconds
    path: "/",
    secure: false,
  },
  name: "launch-school-todos-session-id",
  resave: false,
  saveUninitialized: true,
  secret: "this is not very secure",
  store: new LokiStore({}),
}));

app.use(flash());

// Set up persistent session data
// app.use((req, res, next) => {
//   req.session.todoLists = SeedData;
//   let todoLists = [];
//   if ("todoLists" in req.session) {
//     req.session.todoLists.forEach(todoList => {
//       todoLists.push(TodoList.makeTodoList(todoList));
//     });
//   }

//   req.session.todoLists = todoLists;
//   next();
// });

//Create a new datastore
app.use((req, res, next) => {
  res.locals.store = new SessionPersistence(req.session);
  next();
})

// Extract session info
app.use((req, res, next) => {
  res.locals.username = req.session.username;
  res.locals.signedIn = req.session.signedIn;
  res.locals.flash = req.session.flash;
  delete req.session.flash;
  next();
});

function requiresAuthentication(req, res, next) {
  if (!res.locals.signedIn) {
    res.redirect(302, "/users/signin");
  } else {
    next();
  }
}

//Log In Page
app.get("/users/signin", (req, res, next) => {
  req.flash("info", "Please sign in.");
  res.render("signin", {
    flash: req.flash()
  });
});

//Log In Post
app.post("/users/signin", catchError(async (req, res, next) => {
  let store = res.locals.store;
  let username = req.body.username.trim();
  let password = req.body.password;
  let authenticated = await store.authenticate(username, password);
  if (!authenticated) {
    req.flash("error", "Invalid credentials.");
    res.render("signin", {
      flash: req.flash(),
      username
    });
  } else {
    let session = req.session;
    session.username = username;
    session.signedIn = true;
    req.flash("success", "Welcome!");
    res.redirect('/lists');
  };
}));


// Redirect start page
app.get("/", requiresAuthentication, (req, res) => {
  res.redirect("/lists");
});

// Render the list of todo lists
app.get("/lists", requiresAuthentication, catchError(async (req, res, next) => {
  let store = res.locals.store;
  let todoLists
  todoLists = await store.sortedTodoLists();
  let todosInfo = await Promise.all(todoLists.map(async todoList => {
    return {
      countAllTodos: todoList.todos.length,
      countDoneTodos: todoList.todos.filter(todo => todo.done === true).length,
      isDone: await store.isDoneTodoList(todoList)
    }
  }));
  res.render("lists", {
    todoLists,
    todosInfo,
  });
})
);

// Render new todo list page
app.get("/lists/new", requiresAuthentication, (req, res, next) => {
  res.render("new-list");
});

// Create a new todo list
app.post("/lists", requiresAuthentication,
  [
    body("todoListTitle")
      .trim()
      .isLength({ min: 1 })
      .withMessage("The list title is required.")
      .isLength({ max: 100 })
      .withMessage("List title must be between 1 and 100 characters.")
    // .custom((title, { req }) => {
    //   let todoLists = req.session.todoLists;
    //   let duplicate = todoLists.find(list => list.title === title);
    //   return duplicate === undefined;
    // })
    // .withMessage("List title must be unique."),
  ],
  catchError(async (req, res) => {
    let errors = validationResult(req);
    let store = res.locals.store;
    let title = req.body.todoListTitle;
    if (!errors.isEmpty()) {
      errors.array().forEach(message => req.flash("error", message.msg));
      res.render("new-list", {
        flash: req.flash(),
        todoListTitle: req.body.todoListTitle,
      });
    } else {
      try {
        await store.createNewTodoList(title)
        req.flash("success", "The todo list has been created.");
        res.redirect("/lists");
      } catch (error) {
        if (store.isUniqueConstraintViolation(error)) {
          req.flash("error", "The todo list title must be unique");
          res.redirect("/lists/new");
        } else {
          next(error);
        }
      }
    }
  }
  ));

// Render individual todo list and its todos
app.get("/lists/:todoListId", requiresAuthentication, catchError(async (req, res, next) => {
  let todoListId = req.params.todoListId;
  let store = res.locals.store;
  let todoList = await store.loadTodoList(+todoListId);
  todoList.todos = await store.sortedTodos(todoList);
  if (todoList === undefined) {
    next(new Error("Not found."));
  } else {
    res.render("list", {
      todoList,
      isTodoListDone: await store.isDoneTodoList(todoList),
      hasUndoneTodos: await store.hasUndoneTodos(todoList),
    });
  }
})
);

// Render edit todo list form
app.get("/lists/:todoListId/edit", requiresAuthentication, catchError(async (req, res, next) => {
  let todoListId = req.params.todoListId;
  let todoList = await res.locals.store.loadTodoList(+todoListId);
  if (!todoList) {
    next(new Error("Not found."));
  } else {
    res.render("edit-list", { todoList });
  }
}));


app.post("/users/signout", (req, res, next) => {
  delete req.session.username;
  req.session.signedIn = false;
  res.redirect('/users/signin');
});

// Toggle completion status of a todo
app.post("/lists/:todoListId/todos/:todoId/toggle", requiresAuthentication, catchError(async (req, res, next) => {
  let { todoListId, todoId } = { ...req.params };
  let store = res.locals.store;
  let todo = await store.loadTodo(+todoListId, +todoId);
  if (!todo) {
    next(new Error("Not found."));
  } else {
    let title = todo.title;
    if (todo.done) {
      await store.markTodoUndone(+todoListId, +todoId);
      req.flash("success", `"${title}" marked as NOT done!`);
    } else {
      await store.markTodoDone(+todoListId, +todoId);
      req.flash("success", `"${title}" marked done.`);
    }
    res.redirect(`/lists/${todoListId}`);
  }
})
);

// Delete a todo
app.post("/lists/:todoListId/todos/:todoId/destroy", requiresAuthentication, catchError(async (req, res, next) => {
  let { todoListId, todoId } = { ...req.params };
  let store = res.locals.store;
  let todo = await store.loadTodo(+todoListId, +todoId);
  if (!todo) {
    next(new Error("Not found."));
  } else {
    store.deleteTodo(+todoListId, +todoId);
    req.flash("success", "The todo has been deleted.");
    res.redirect(`/lists/${todoListId}`);
  }
})
);

// Mark all todos as done
app.post("/lists/:todoListId/complete_all", requiresAuthentication, catchError(async (req, res, next) => {
  let todoListId = req.params.todoListId;
  let store = res.locals.store;
  let todoList = await store.loadTodoList(+todoListId)
  if (!todoList) {
    next(new Error("Not found."));
  } else {
    await store.markAllTodosDone(+todoListId);
    req.flash("success", "All todos have been marked as done.");
    res.redirect(`/lists/${todoListId}`);
  }
})
);

// Create a new todo and add it to the specified list
app.post("/lists/:todoListId/todos",
  [
    body("todoTitle")
      .trim()
      .isLength({ min: 1 })
      .withMessage("The todo title is required.")
      .isLength({ max: 100 })
      .withMessage("Todo title must be between 1 and 100 characters."),
  ],
  requiresAuthentication, catchError(async (req, res, next) => {
    let todoListId = req.params.todoListId;
    let store = res.locals.store;
    let todoList = await store.loadTodoList(+todoListId);
    if (!todoList) {
      next(new Error("Not found."));
    } else {
      let errors = validationResult(req);
      if (!errors.isEmpty()) {
        errors.array().forEach(message => req.flash("error", message.msg));
        res.render("list", {
          flash: req.flash(),
          todoList,
          isTodoListDone: await store.isDoneTodoList(todoList),
          hasUndoneTodos: await store.hasUndoneTodos(todoList),
        });
      } else {
        store.createNewTodo(+todoListId, req.body.todoTitle);
        req.flash("success", "The todo has been created.");
        res.redirect(`/lists/${todoListId}`);
      }
    }
  })
);

// Delete todo list
app.post("/lists/:todoListId/destroy", requiresAuthentication, catchError(async (req, res, next) => {
  let store = res.locals.store;
  let todoListId = req.params.todoListId;
  let todoList = await store.loadTodoList(+todoListId);
  if (!todoList) {
    next(new Error("Not found."));
  } else {
    store.deleteTodoList(+todoListId);
    req.flash("success", "Todo list deleted.");
    res.redirect("/lists");
  }
}));

// Edit todo list title
app.post("/lists/:todoListId/edit",
  [
    body("todoListTitle")
      .trim()
      .isLength({ min: 1 })
      .withMessage("The list title is required.")
      .isLength({ max: 100 })
      .withMessage("List title must be between 1 and 100 characters.")
    // .custom((title, { req }) => {
    //   let todoLists = req.session.todoLists;
    //   let duplicate = todoLists.find(list => list.title === title);
    //   return duplicate === undefined;
    // })
    // .withMessage("List title must be unique."),
  ],
  requiresAuthentication, catchError(async (req, res, next) => {
    let todoListId = req.params.todoListId;
    let title = req.body.todoListTitle;
    let store = res.locals.store;
    let errors = validationResult(req);
    if (!errors.isEmpty()) {
      errors.array().forEach(message => req.flash("error", message.msg));

      res.render("edit-list", {
        flash: req.flash(),
        todoListTitle: req.body.todoListTitle,
        todoList: store.loadTodoList(+todoListId),
      });

    } else if (store.existsTodoListTitle(title)) {
      req.flash("error", 'Todo List title must be unique');

      res.render("edit-list", {
        flash: req.flash(),
        todoListTitle: req.body.todoListTitle,
        todoList: store.loadTodoList(+todoListId),
      });
    } else {
      try {
        let todoList = await store.changeTodoListTitle(+todoListId, title);
        if (todoList) {
          req.flash("success", "Todo list updated.");
          res.redirect(`/lists/${todoListId}`);
        } else {
          next(new Error("Not found."));
        }
      } catch (error) {
        if (store.isUniqueConstraintViolation(error)) {
          req.flash("error", "Todo list name must be unique");
          res.redirect(`/lists/${todoListId}`);
        } else {
          next(error);
        }
      }
    }
  }
  ));

// Error handler
app.use((err, req, res, _next) => {
  console.log(err); // Writes more extensive information to the console log
  res.status(404).send(err.message);
});

// Listener
app.listen(port, host, () => {
  console.log(`Todos is listening on port ${port} of ${host}!`);
});