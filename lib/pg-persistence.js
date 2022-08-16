const Todo = require("./todo");
const TodoList = require("./todolist");
const session = require("express-session");
const { dbQuery } = require("./db-query")
const { sortTodoLists } = require("./sort");
const bcrypt = require("bcrypt");

module.exports = class PgPersistence {
  constructor(session) {
    this.username = session.username;
  }  

  async _partitionTodoLists(todoLists) {
    let undone = [];
    let done = [];
    for (let todoList of todoLists) {
      if (await this.isDoneTodoList(todoList)) {
        done.push(todoList);
      } else {
        undone.push(todoList);
      }
    }
    return [...undone, ...done];
  }

  async authenticate(username, password) {
    const FIND_HASHED_PASSWORD = "SELECT password FROM users WHERE username=$1";
    let result = await dbQuery(FIND_HASHED_PASSWORD, username);
    if (result.rowCount === 0) return false;
    return bcrypt.compare(password, result.rows[0].password);
  }

  async sortedTodoLists() {
    let todoListsQuery =  dbQuery("SELECT * FROM todolists WHERE username =$1 ORDER BY title ASC", this.username);
    let todosQuery = dbQuery("SELECT * FROM todos WHERE username =$1 ORDER BY title ASC", this.username);
    let results = await Promise.all([todoListsQuery, todosQuery]);
    let todoLists = results[0].rows;
    let todos = results[1].rows;
    if (!todoLists || !todos) return undefined;
    for (let todoList of todoLists) {
      todoList.todos = todos.filter(todo => todo.todolist_id === todoList.id);
    }
    return await this._partitionTodoLists(todoLists);
  }

  async isDoneTodoList(todoList) {
    let sql_undone = "SELECT * FROM todos WHERE todolist_id = $1 AND done = false";
    let sql_done = "SELECT * FROM todos WHERE todolist_id = $1 AND done = true";
    let undone = (await dbQuery(sql_undone, todoList.id)).rows;
    let done = (await dbQuery(sql_done, todoList.id)).rows;
    return undone.length === 0 && done.length != 0;
  }

  // Find a todo list with the indicated ID. Returns `undefined` if not found.
  // Note that `todoListId` must be numeric.
  async loadTodoList(todoListId) {
    let sql = "SELECT * FROM todolists WHERE id = $1 AND username = $2";
    let todoList = (await dbQuery(sql, todoListId, this.username)).rows[0];
    todoList.todos = await this.sortedTodos(todoList);
    return todoList;
  };

  hasUndoneTodos(todoList) {
    return todoList.todos.some(todo => !todo.done)
  }

  async sortedTodos(todoList) {
    let sql = "SELECT * FROM todos WHERE todolist_id=$1 AND username = $2 ORDER BY done ASC, title ASC";
    return (await dbQuery(sql, todoList.id, this.username)).rows;
  }

  async loadTodo(todoListId, todoId) {
    let todoList = this.loadTodoList(todoListId);
    if (todoList) {
      let sql = "SELECT * FROM todos WHERE id = $1 AND todolist_id = $2 AND username = $3";
      let todo = (await dbQuery(sql, todoId, todoListId, this.username)).rows[0];
      return todo;
    } else {
      return undefined;
    }
  }

  markTodoDone(todoListId, todoId) {
    let sql = "UPDATE todos SET done = true WHERE id = $1 AND todolist_id = $2"
    dbQuery(sql, todoId, todoListId);
  }

  markTodoUndone(todoListId, todoId) {
    let sql = "UPDATE todos SET done = false WHERE id = $1 AND todolist_id = $2"
    dbQuery(sql, todoId, todoListId);
  }

  async deleteTodoList(todoListId) {
    let sql = "DELETE FROM todolists WHERE id = $1 AND username = $2"
    dbQuery(sql, todoListId, this.username);
  }

  async deleteTodo(todoListId, todoId) {
    let sql = "DELETE FROM todos WHERE id = $1 AND todolist_id = $2 AND username = $3"
    dbQuery(sql, todoId, todoListId, thsi.username);
  }

  markAllTodosDone(todoListId) {
    let sql = "UPDATE todos SET done = true WHERE todolist_id = $1"
    dbQuery(sql, todoListId);
  }

  createNewTodo(todoListId, title) {
    let sql = "INSERT INTO todos (title, todolist_id, username) VALUES ($1, $2, $3)"
    dbQuery(sql, title, todoListId, this.username);
  }

  async changeTodoListTitle(todoListId, title) {
    let sql = "UPDATE todolists SET title = $1 WHERE id = $2 AND username = $3"
    let result = await dbQuery(sql, title, todoListId, this.username);
    return result.rowCount === 1;
  }

  isUniqueConstraintViolation(error) {
    return /duplicate key value violates unique constraint/.test(String(error));
  }

  async createNewTodoList(title) {
    let sql = "INSERT INTO todolists (title, username) VALUES ($1, $2)";
    await dbQuery(sql, title, this.username);
  }
}