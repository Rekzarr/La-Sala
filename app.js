(function () {
  "use strict";

  const STORAGE_KEY = "la-sala-data-v1";
  const TMDB_KEY_STORAGE = "la-sala-tmdb-key";
  const MEMBER_IDS = ["member-1", "member-2", "member-3", "member-4"];
  const workspace = document.getElementById("workspace");
  const movieList = document.getElementById("movieList");
  const emptyState = document.getElementById("emptyState");
  const message = document.getElementById("message");
  const membersDialog = document.getElementById("membersDialog");
  const membersForm = document.getElementById("membersForm");
  const backupDialog = document.getElementById("backupDialog");
  const backupFile = document.getElementById("backupFile");
  const fatalError = document.getElementById("fatalError");
  let state;
  let activeFilter = "all";
  let searchTerm = "";
  let editingMovieId = null;
  let messageTimer;
  let suggestionTimer;
  let suggestionRequest = 0;

  function emptyData() {
    return {
      version: 1,
      members: [],
      currentMemberId: "",
      movies: []
    };
  }

  function validateData(data, allowEmptyGroup) {
    if (!data || data.version !== 1 || !Array.isArray(data.members) || !Array.isArray(data.movies)) {
      throw new Error("El archivo no tiene el formato de copia esperado.");
    }

    if (data.members.length !== 4 && !(allowEmptyGroup && data.members.length === 0)) {
      throw new Error("La copia debe contener exactamente cuatro perfiles.");
    }

    const ids = new Set();
    data.members.forEach(function (member, index) {
      if (!member || member.id !== MEMBER_IDS[index] || typeof member.name !== "string" ||
          !member.name.trim() || member.name.length > 32 || ids.has(member.id)) {
        throw new Error("Los nombres o perfiles de la copia no son válidos.");
      }
      ids.add(member.id);
    });

    if (data.members.length === 4 && !ids.has(data.currentMemberId)) {
      throw new Error("El perfil seleccionado en la copia no es válido.");
    }

    const movieIds = new Set();
    data.movies.forEach(function (movie) {
      if (!movie || typeof movie.id !== "string" || !movie.id ||
          typeof movie.title !== "string" || !movie.title.trim() ||
          movie.title.length > 120 || typeof movie.watched !== "boolean" ||
          (movie.poster !== undefined && (typeof movie.poster !== "string" || movie.poster.length > 1000)) ||
          !movie.ratings || typeof movie.ratings !== "object" || movieIds.has(movie.id)) {
        throw new Error("Una de las películas de la copia no es válida.");
      }

      movieIds.add(movie.id);
      Object.keys(movie.ratings).forEach(function (memberId) {
        const score = movie.ratings[memberId];
        if (!ids.has(memberId) || !Number.isInteger(score) || score < 1 || score > 10) {
          throw new Error("Una de las puntuaciones de la copia no es válida.");
        }
      });
    });

    return data;
  }

  function loadData() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return emptyData();
    }
    return validateData(JSON.parse(raw), true);
  }

  function saveData(nextState) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
      state = nextState;
      return true;
    } catch (error) {
      showMessage("No se pudieron guardar los cambios. Comprueba el espacio disponible del navegador.", true);
      return false;
    }
  }

  function cloneState() {
    return JSON.parse(JSON.stringify(state));
  }

  function showMessage(text, isError) {
    window.clearTimeout(messageTimer);
    message.textContent = text;
    message.classList.toggle("is-error", Boolean(isError));
    if (text) {
      messageTimer = window.setTimeout(function () {
        message.textContent = "";
        message.classList.remove("is-error");
      }, 5000);
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[character];
    });
  }

  function getTmdbKey() {
    return localStorage.getItem(TMDB_KEY_STORAGE) || "";
  }

  function openApiKeyDialog() {
    document.getElementById("apiKeyError").textContent = "";
    document.getElementById("apiKeyInput").value = getTmdbKey();
    document.getElementById("apiKeyDialog").showModal();
  }

  function hideSuggestions() {
    const suggestions = document.getElementById("movieSuggestions");
    suggestions.innerHTML = "";
    suggestions.hidden = true;
  }

  async function searchMovieSuggestions(query) {
    const key = getTmdbKey();
    if (!key) {
      hideSuggestions();
      openApiKeyDialog();
      return;
    }

    const requestId = ++suggestionRequest;
    const url = "https://api.themoviedb.org/3/search/movie?api_key=" + encodeURIComponent(key) +
      "&language=es-ES&include_adult=false&query=" + encodeURIComponent(query);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(response.status === 401
          ? "La clave de TMDB no es válida."
          : "No se pudo consultar TMDB.");
      }

      const data = await response.json();
      if (requestId !== suggestionRequest) {
        return;
      }

      const suggestions = data.results || [];
      const container = document.getElementById("movieSuggestions");
      if (!suggestions.length) {
        hideSuggestions();
        return;
      }

      container.innerHTML = suggestions.slice(0, 8).map(function (movie) {
        const year = typeof movie.release_date === "string" && movie.release_date
          ? " · " + movie.release_date.slice(0, 4)
          : "";
        const poster = movie.poster_path
          ? '<img src="https://image.tmdb.org/t/p/w92' + escapeHtml(movie.poster_path) + '" alt="">'
          : '<span class="suggestion-empty">L</span>';
        const title = movie.title || movie.original_title || "Película";
        return '<button class="movie-suggestion" type="button" role="option" data-title="' + escapeHtml(title) +
          '" data-poster="' + escapeHtml(movie.poster_path
            ? "https://image.tmdb.org/t/p/w342" + movie.poster_path
            : "") + '">' +
          poster + '<span><strong>' + escapeHtml(title) + "</strong><small>" +
          escapeHtml(year.replace(" · ", "")) + "</small></span></button>";
      }).join("");
      container.hidden = false;

      container.querySelectorAll(".movie-suggestion").forEach(function (button) {
        button.addEventListener("click", function () {
          document.getElementById("movieTitle").value = button.dataset.title;
          document.getElementById("moviePoster").value = button.dataset.poster;
          hideSuggestions();
          document.getElementById("movieTitle").focus();
        });
      });
    } catch (error) {
      if (requestId === suggestionRequest) {
        hideSuggestions();
        showMessage(error.message || "No se pudo buscar la película.", true);
      }
    }
  }

  function renderMemberPicker() {
    const select = document.getElementById("memberSelect");
    select.innerHTML = state.members.map(function (member) {
      return '<option value="' + escapeHtml(member.id) + '">' + escapeHtml(member.name) + "</option>";
    }).join("");
    select.value = state.currentMemberId;
  }

  function ratingOptions(selected) {
    let options = '<option value="">Elige…</option>';
    for (let score = 1; score <= 10; score += 1) {
      options += '<option value="' + score + '"' + (score === selected ? " selected" : "") + ">" + score + "</option>";
    }
    return options;
  }

  function renderMovie(movie) {
    const votes = Object.keys(movie.ratings);
    const isComplete = state.members.every(function (member) {
      return Object.prototype.hasOwnProperty.call(movie.ratings, member.id);
    });
    const memberVote = movie.ratings[state.currentMemberId];
    const isEditing = editingMovieId === movie.id;
    const stateLabel = movie.watched ? "VISTA" : "PENDIENTE";
    let voteContent = "";

    if (!movie.watched) {
      voteContent = '<p class="vote-info">Cuando la veáis, marcadla como vista para empezar a puntuar.</p>';
    } else if (isComplete) {
      const total = state.members.reduce(function (sum, member) {
        return sum + movie.ratings[member.id];
      }, 0);
      const average = (total / state.members.length).toLocaleString("es-ES", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      });
      const scores = state.members.map(function (member) {
        return '<span class="score-chip">' + escapeHtml(member.name) + " · " + movie.ratings[member.id] + "</span>";
      }).join("");
      voteContent = '<div class="score-summary"><div class="average-score">★ ' + average +
        ' <small>/ 10 media</small></div><div class="member-scores">' + scores + "</div></div>";
      if (memberVote !== undefined && !isEditing) {
        voteContent += '<p class="vote-info">Votación completa. Puedes cambiar tu nota si lo necesitas.</p>';
      }
    } else if (memberVote !== undefined && !isEditing) {
      voteContent = '<p class="vote-info">Tu voto está guardado. Las notas y la media se mostrarán cuando voten los cuatro.</p>';
    } else {
      voteContent = '<p class="vote-info">' + votes.length + " de 4 votos · notas ocultas hasta completar la votación.</p>";
    }

    const showRatingForm = movie.watched && (!isComplete || isEditing);
    if (showRatingForm && (memberVote === undefined || isEditing)) {
      voteContent += '<form class="rating-form" data-movie-id="' + escapeHtml(movie.id) + '">' +
        '<label>Tu nota<select name="score" required aria-label="Tu nota para ' + escapeHtml(movie.title) + '">' +
        ratingOptions(memberVote) + '</select></label>' +
        '<button class="button button-primary" type="submit">' +
        (memberVote === undefined ? "Guardar voto" : "Actualizar nota") + "</button></form>";
    }

    const editButton = movie.watched && memberVote !== undefined && !isEditing
      ? '<button class="button button-quiet" type="button" data-action="edit" data-id="' + escapeHtml(movie.id) + '">' +
        "Cambiar nota</button>"
      : "";
    const watchedButton = !movie.watched
      ? '<button class="button button-primary" type="button" data-action="watched" data-id="' + escapeHtml(movie.id) + '">La vimos</button>'
      : "";
    const poster = typeof movie.poster === "string" && movie.poster
      ? '<img class="movie-poster" src="' + escapeHtml(movie.poster) + '" alt="Carátula de ' + escapeHtml(movie.title) + '" loading="lazy">'
      : '<div class="movie-poster movie-poster-empty" aria-hidden="true">L</div>';

    return '<article class="movie-card">' +
      poster +
      '<div class="movie-main"><div class="movie-title-line"><h3 class="movie-title">' + escapeHtml(movie.title) +
      '</h3><span class="movie-state' + (movie.watched ? "" : " is-pending") + '">' + stateLabel +
      "</span></div>" + voteContent + "</div>" +
      '<div class="movie-actions">' + editButton + watchedButton +
      '<button class="icon-button" type="button" data-action="delete" data-id="' + escapeHtml(movie.id) +
      '" aria-label="Eliminar ' + escapeHtml(movie.title) + '" title="Eliminar película">×</button></div></article>';
  }

  function render() {
    const memberSelect = document.getElementById("memberSelect");
    const hasGroup = state.members.length === 4;
    document.getElementById("editMembersButton").disabled = !hasGroup;
    document.getElementById("backupButton").disabled = !hasGroup;
    workspace.hidden = !hasGroup;

    if (!hasGroup) {
      return;
    }

    renderMemberPicker();
    const filtered = state.movies.filter(function (movie) {
      const matchesFilter = activeFilter === "all" ||
        (activeFilter === "watchlist" && !movie.watched) ||
        (activeFilter === "watched" && movie.watched);
      return matchesFilter && movie.title.toLocaleLowerCase("es").includes(searchTerm);
    });

    document.getElementById("movieCount").textContent = String(state.movies.length);
    movieList.innerHTML = filtered.map(renderMovie).join("");
    emptyState.hidden = filtered.length !== 0;
    if (!filtered.length) {
      const hasMovies = state.movies.length > 0;
      document.getElementById("emptyTitle").textContent = hasMovies ? "No hay resultados" : "Aún no hay películas";
      document.getElementById("emptyCopy").textContent = hasMovies
        ? "Prueba con otro título o cambia el filtro."
        : "Añadid la primera y empezad vuestra colección.";
    }
    memberSelect.value = state.currentMemberId;
  }

  function openMembersDialog() {
    const names = state.members.map(function (member) {
      return member.name;
    });
    MEMBER_IDS.forEach(function (id, index) {
      membersForm.elements["member" + (index + 1)].value = names[index] || "";
    });
    document.getElementById("membersDialogTitle").textContent = state.members.length
      ? "Vuestros perfiles"
      : "¿Quiénes sois?";
    document.getElementById("cancelMembersButton").hidden = state.members.length === 0;
    document.getElementById("membersError").textContent = "";
    membersDialog.showModal();
  }

  document.getElementById("apiKeyButton").addEventListener("click", openApiKeyDialog);

  document.getElementById("cancelApiKeyButton").addEventListener("click", function () {
    document.getElementById("apiKeyDialog").close();
  });

  document.getElementById("apiKeyForm").addEventListener("submit", function (event) {
    event.preventDefault();
    const key = document.getElementById("apiKeyInput").value.trim();
    if (!key) {
      document.getElementById("apiKeyError").textContent = "Introduce una clave de TMDB.";
      return;
    }
    localStorage.setItem(TMDB_KEY_STORAGE, key);
    document.getElementById("apiKeyError").textContent = "";
    document.getElementById("apiKeyDialog").close();
    showMessage("Clave TMDB guardada en este dispositivo.");
  });

  document.getElementById("movieTitle").addEventListener("input", function (event) {
    const query = event.target.value.trim();
    window.clearTimeout(suggestionTimer);
    if (query.length < 2) {
      hideSuggestions();
      return;
    }
    suggestionTimer = window.setTimeout(function () {
      searchMovieSuggestions(query);
    }, 350);
  });

  document.getElementById("movieTitle").addEventListener("blur", function () {
    window.setTimeout(hideSuggestions, 150);
  });

  document.getElementById("posterSearchButton").addEventListener("click", function () {
    const title = document.getElementById("movieTitle").value.trim();
    if (!title) {
      document.getElementById("movieTitle").focus();
      showMessage("Escribe primero el título de la película.", true);
      return;
    }
    window.open("https://www.themoviedb.org/search?query=" + encodeURIComponent(title), "_blank", "noopener,noreferrer");
  });

  document.getElementById("addMovieForm").addEventListener("submit", function (event) {
    event.preventDefault();
    const titleInput = document.getElementById("movieTitle");
    const title = titleInput.value.trim();
    const posterInput = document.getElementById("moviePoster");
    const poster = posterInput.value.trim();
    if (!title) {
      return;
    }

    const alreadyExists = state.movies.some(function (movie) {
      return movie.title.toLocaleLowerCase("es") === title.toLocaleLowerCase("es");
    });
    if (alreadyExists) {
      showMessage("Esa película ya está en vuestra colección.", true);
      return;
    }

    const next = cloneState();
    next.movies.unshift({
      id: "movie-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      title: title,
      poster: poster,
      watched: document.getElementById("alreadyWatched").checked,
      ratings: {}
    });
    if (saveData(next)) {
      titleInput.value = "";
      posterInput.value = "";
      showMessage("Película añadida.");
      render();
    }
  });

  document.getElementById("memberSelect").addEventListener("change", function (event) {
    const next = cloneState();
    next.currentMemberId = event.target.value;
    editingMovieId = null;
    if (saveData(next)) {
      render();
    }
  });

  document.getElementById("searchInput").addEventListener("input", function (event) {
    searchTerm = event.target.value.trim().toLocaleLowerCase("es");
    render();
  });

  document.querySelector(".filter-tabs").addEventListener("click", function (event) {
    const button = event.target.closest("[data-filter]");
    if (!button) {
      return;
    }
    activeFilter = button.dataset.filter;
    document.querySelectorAll(".filter-tab").forEach(function (tab) {
      tab.classList.toggle("is-active", tab === button);
    });
    render();
  });

  movieList.addEventListener("click", function (event) {
    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }
    const movie = state.movies.find(function (item) {
      return item.id === button.dataset.id;
    });
    if (!movie) {
      return;
    }

    if (button.dataset.action === "edit") {
      editingMovieId = movie.id;
      render();
      const ratingForm = Array.from(movieList.querySelectorAll(".rating-form")).find(function (form) {
        return form.dataset.movieId === movie.id;
      });
      const scoreSelect = ratingForm && ratingForm.querySelector('select[name="score"]');
      if (scoreSelect) {
        scoreSelect.focus();
      }
    } else if (button.dataset.action === "watched") {
      const next = cloneState();
      const target = next.movies.find(function (item) {
        return item.id === movie.id;
      });
      target.watched = true;
      if (saveData(next)) {
        render();
        showMessage("¡A puntuar!");
      }
    } else if (button.dataset.action === "delete") {
      if (!window.confirm('¿Eliminar "' + movie.title + '" y sus puntuaciones?')) {
        return;
      }
      const next = cloneState();
      next.movies = next.movies.filter(function (item) {
        return item.id !== movie.id;
      });
      if (saveData(next)) {
        editingMovieId = null;
        render();
        showMessage("Película eliminada.");
      }
    }
  });

  movieList.addEventListener("submit", function (event) {
    const form = event.target.closest(".rating-form");
    if (!form) {
      return;
    }
    event.preventDefault();
    const score = Number(new FormData(form).get("score"));
    if (!Number.isInteger(score) || score < 1 || score > 10) {
      showMessage("Elige una nota del 1 al 10.", true);
      return;
    }

    const next = cloneState();
    const movie = next.movies.find(function (item) {
      return item.id === form.dataset.movieId;
    });
    if (!movie || !movie.watched) {
      showMessage("No se pudo guardar el voto para esta película.", true);
      return;
    }
    movie.ratings[next.currentMemberId] = score;
    if (saveData(next)) {
      editingMovieId = null;
      render();
      showMessage("Voto guardado.");
    }
  });

  document.getElementById("editMembersButton").addEventListener("click", openMembersDialog);

  membersForm.addEventListener("submit", function (event) {
    event.preventDefault();
    const names = MEMBER_IDS.map(function (id, index) {
      return membersForm.elements["member" + (index + 1)].value.trim();
    });
    const normalized = names.map(function (name) {
      return name.toLocaleLowerCase("es");
    });
    if (names.some(function (name) { return !name; })) {
      document.getElementById("membersError").textContent = "Escribid los cuatro nombres.";
      return;
    }
    if (new Set(normalized).size !== names.length) {
      document.getElementById("membersError").textContent = "Usad un nombre distinto para cada perfil.";
      return;
    }

    const next = cloneState();
    next.members = names.map(function (name, index) {
      return { id: MEMBER_IDS[index], name: name };
    });
    if (!next.currentMemberId || !MEMBER_IDS.includes(next.currentMemberId)) {
      next.currentMemberId = MEMBER_IDS[0];
    }
    if (saveData(next)) {
      membersDialog.close();
      render();
      showMessage("Perfiles guardados en este dispositivo.");
    }
  });

  document.getElementById("cancelMembersButton").addEventListener("click", function () {
    membersDialog.close();
  });

  membersDialog.addEventListener("cancel", function (event) {
    if (state.members.length === 0) {
      event.preventDefault();
    }
  });

  document.getElementById("backupButton").addEventListener("click", function () {
    backupDialog.showModal();
  });

  document.getElementById("importButton").addEventListener("click", function () {
    backupDialog.close();
    backupFile.click();
  });

  backupFile.addEventListener("change", async function (event) {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    try {
      const imported = validateData(JSON.parse(await file.text()), false);
      if (!window.confirm("Importar esta copia reemplazará la colección actual. ¿Queréis continuar?")) {
        return;
      }
      if (saveData(imported)) {
        editingMovieId = null;
        render();
        showMessage("Copia importada.");
      }
    } catch (error) {
      showMessage(error.message || "No se pudo leer la copia de seguridad.", true);
    } finally {
      backupFile.value = "";
    }
  });

  document.getElementById("downloadBackupButton").addEventListener("click", function () {
    const contents = JSON.stringify(state, null, 2);
    const blob = new Blob([contents], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "la-sala-copia-" + new Date().toISOString().slice(0, 10) + ".json";
    link.click();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
    backupDialog.close();
  });

  try {
    state = loadData();
    render();
    if (state.members.length === 0) {
      openMembersDialog();
    }
  } catch (error) {
    workspace.hidden = true;
    fatalError.hidden = false;
    document.getElementById("fatalErrorCopy").textContent =
      "Los datos guardados no se han modificado. " + (error.message || "Puede que estén dañados o que el navegador no permita acceder al almacenamiento.");
  }

  if ("serviceWorker" in navigator && window.isSecureContext && window.location.protocol !== "file:") {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").catch(function (error) {
        console.error("No se pudo activar el modo sin conexión.", error);
        showMessage("No se pudo activar el modo sin conexión en este navegador.", true);
      });
    });
  }

}());
