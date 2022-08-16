const SeedData = require("./seed-data.js");
const deepCopy = require("./deep-copy");
const Todo = require("./todo");
const TodoList = require("./todolist");
const { sortTodoLists, sortTodos } = require("./sort.js");
const session = require("express-session");

module.exports = class SessionPersistence {
  constructor(session) {
    this._todoLists = session.todoLists || deepCopy(SeedData);
    session.todoLists = this._todoLists;
  }

  _findTodo(todoListId, todoId) {
    let todoList = this._todoLists.find(todoList => todoList.id === todoListId);
    return todoList.todos.find(todo => todo.id === todoId);
  }

  _findTodoList(todoListId) {
    return this._todoLists.find(todoList => todoList.id === todoListId);
  }

  sortedTodoLists() {
    let todoLists = deepCopy(this._todoLists);
    let undone = todoLists.filter(todoList => !this.isDoneTodoList(todoList));
    let done = todoLists.filter(todoList => this.isDoneTodoList(todoList));
    return sortTodoLists(undone, done);
  }

  isDoneTodoList(todoList) {
    return todoList.todos.length > 0 && todoList.todos.every(todo => todo.done);
  }

  countAllTodos(todoList) {
    return todoList.todos.length;
  }

  countDoneTodos(todoList) {
    return todoList.todos.filter(todo => todo.done).length;
  }

  // Find a todo list with the indicated ID. Returns `undefined` if not found.
  // Note that `todoListId` must be numeric.
  loadTodoList(todoListId) {
    let todoList = this._todoLists.find(todoList => todoList.id === todoListId);
    return deepCopy(todoList);
  };

  hasUndoneTodos(todoList) {
    return todoList.todos.some(todo => !todo.done)
  }

  sortedTodos(todoList) {
    let todos = todoList.todos;
    let undone = todos.filter(todo => !todo.done);
    let done = todos.filter(todo => todo.done);
    return deepCopy(sortTodos(undone, done));
  }

  loadTodo(todoListId, todoId) {
    let todoList = this.loadTodoList(todoListId);
    if (todoList) {
      let todo = todoList.todos.find(todo => todo.id === todoId)
      return deepCopy(todo);
    } else {
      return undefined;
    }
  }

  isDoneTodo(todoListId, todoId) {
    let todoList = this._todoLists.find(todoList => todoList.id === todoListId);
    let todo = todoList.todos.find(todo => todo.id === todoId);
    return todo.done;
  }

  markTodoDone(todoListId, todoId) {
    let todo = this._findTodo(todoListId, todoId);
    todo.done = true;
  }

  markTodoUndone(todoListId, todoId) {
    let todo = this._findTodo(todoListId, todoId);
    todo.done = false;
  }

  deleteTodoList(todoListId) {
    let todoListIndex = this._todoLists.findIndex(todoList => todoList.id === todoListId);
    this._todoLists.splice(todoListIndex, 1);
  }

  deleteTodo(todoListId, todoId) {
    let todoList = this._findTodoList(todoListId);
    let todoIndex = todoList.todos.findIndex(todo => todo.id = todoId);
    todoList.todos.splice(todoIndex, 1);
  }

  markAllTodosDone(todoListId) {
    let todoList = this._findTodoList(todoListId);
    todoList.todos.forEach(todo => {
      todo.done = true;
    })
  }

  createNewTodo(todoListId, title) {
    let todoList = this._findTodoList(todoListId);
    todoList.todos.push(new Todo(title));
  }

  changeTodoListTitle(todoListId, title) {
    let todoList = this._findTodoList(todoListId);
    if (todoList) {
      todoList.title = title;
      return true;
    } else {
      return false;
    }
  }

  existsTodoListTitle(title) {
    return this._todoLists.some(todoList => todoList.title === title)
  }

  createNewTodoList(title) {
    let newTodoList = new TodoList(title)
    this._todoLists.push(newTodoList);
  }

  isUniqueConstraintViolation(error) {
    return false;
  }
}